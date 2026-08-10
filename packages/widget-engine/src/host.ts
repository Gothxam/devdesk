/**
 * The execution boundary.
 *
 * Everything a widget cannot do for itself, the host does — and the arrangement
 * is deliberately one-way: the host holds widgets, widgets do not hold the host.
 *
 * ```text
 *  registry ─┐
 *  theme ────┼──▶ WidgetHost ──context──▶ widget instance
 *  surfaces ─┘         │
 *                      └── lifecycle, events, teardown
 * ```
 *
 * ## What this buys
 *
 * A widget cannot reach `WindowManager`, the platform, or another widget,
 * because it is never handed anything that could. `create` receives a
 * {@link WidgetContext} and nothing else, the context holds no host reference,
 * and this module exports no singleton for a widget to import. The restriction
 * is structural, so violating it requires a change a reviewer would see rather
 * than a call nobody notices.
 *
 * ## Theme is pushed, not pulled
 *
 * The host holds the current {@link ThemeSnapshot} and rebuilds every attached
 * widget's context when it changes. A widget never asks for the theme, so it
 * cannot ask at the wrong moment and get a half-applied one — the snapshot it
 * holds was resolved before it ever saw it.
 *
 * ## One instance, one surface, one context
 *
 * The context is built at attach and replaced whenever the theme or the display
 * changes. There is no context before attach because there is no surface, and a
 * widget with no surface has nothing to render into.
 */

import {
  type WidgetId,
  type WidgetInstanceId,
  type SurfaceId,
  type MonitorId,
  type WidgetManifest,
  widgetOf,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';
import type { ThemeSnapshot } from '@devdesk/theme-engine';

import { createWidgetContext, withUpdates, type WidgetContext } from './context';
import type { WidgetDefinition, WidgetInstance } from './definition';
import {
  createEventChannel,
  type DeliveryFailure,
  type WidgetEvent,
  type WidgetEventPublisher,
} from './events';
import {
  createLifecycle,
  describeLifecycleError,
  hasSurface,
  type LifecycleError,
  type WidgetLifecycle,
  type WidgetLifecycleEvent,
  type WidgetPhase,
} from './lifecycle';
import type { WidgetRegistry } from './registry';

/** Where a widget is placed. */
export interface SurfacePlacement {
  readonly surfaceId: SurfaceId;
  /** `undefined` when no display is attached — a real state, not an error. */
  readonly monitorId: MonitorId | undefined;
}

/** Why a host operation failed. */
export type HostError =
  | { readonly kind: 'unknown-widget'; readonly id: WidgetId }
  | { readonly kind: 'no-definition'; readonly id: WidgetId }
  | { readonly kind: 'definition-mismatch'; readonly declared: WidgetId; readonly actual: WidgetId }
  | { readonly kind: 'unknown-instance'; readonly id: WidgetInstanceId }
  | { readonly kind: 'already-created'; readonly id: WidgetInstanceId }
  | { readonly kind: 'lifecycle'; readonly id: WidgetInstanceId; readonly cause: LifecycleError };

/** What the host knows about one instance, from the outside. */
export interface InstanceSnapshot {
  readonly instanceId: WidgetInstanceId;
  readonly widgetId: WidgetId;
  readonly phase: WidgetPhase;
  readonly surfaceId: SurfaceId | undefined;
  readonly monitorId: MonitorId | undefined;
}

/** The host's internal record. Never handed out. */
interface LiveInstance<TView> {
  readonly instanceId: WidgetInstanceId;
  readonly widgetId: WidgetId;
  readonly manifest: WidgetManifest;
  readonly definition: WidgetDefinition<TView>;
  readonly channel: WidgetEventPublisher;
  lifecycle: WidgetLifecycle;
  context: WidgetContext | undefined;
  instance: WidgetInstance<TView> | undefined;
}

/** Anything that went wrong while delivering an event, reported not swallowed. */
export interface HostDelivery {
  readonly failures: readonly DeliveryFailure[];
}

/**
 * Runs widgets.
 *
 * Mutable by design — it is the one place instance state lives — but everything
 * it hands out is immutable, so no caller can reach in and change what it holds.
 */
export class WidgetHost<TView = unknown> {
  readonly #definitions = new Map<WidgetId, WidgetDefinition<TView>>();
  readonly #instances = new Map<WidgetInstanceId, LiveInstance<TView>>();
  #registry: WidgetRegistry;
  #theme: ThemeSnapshot;

  constructor(registry: WidgetRegistry, theme: ThemeSnapshot) {
    this.#registry = registry;
    this.#theme = theme;
  }

  /** The current resolved theme. */
  get theme(): ThemeSnapshot {
    return this.#theme;
  }

  /** The widgets the host can build. */
  get registry(): WidgetRegistry {
    return this.#registry;
  }

  /** How many instances exist, in any phase short of destroyed. */
  get instanceCount(): number {
    return this.#instances.size;
  }

  /**
   * Teaches the host how to build a widget.
   *
   * Separate from registering the manifest because they come from different
   * places: a manifest is data that can be read from a file, and a definition is
   * code. Keeping them apart is what will let M3 load a manifest from a bundle
   * and its code from a sandbox without either step knowing about the other.
   */
  define(definition: WidgetDefinition<TView>): Result<void, HostError> {
    const manifest = this.#registry.lookup(definition.id);
    if (!manifest) return err({ kind: 'unknown-widget', id: definition.id });

    return ok(void this.#definitions.set(definition.id, definition));
  }

  /**
   * Creates an instance of a registered widget.
   *
   * The instance exists but has no surface and no context: it is `created`, and
   * {@link WidgetHost.attach} is what gives it somewhere to be.
   */
  create(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    if (this.#instances.has(instanceId)) {
      return err({ kind: 'already-created', id: instanceId });
    }

    const widgetId = widgetOf(instanceId);
    const manifest = this.#registry.lookup(widgetId);
    if (!manifest) return err({ kind: 'unknown-widget', id: widgetId });

    const definition = this.#definitions.get(widgetId);
    if (!definition) return err({ kind: 'no-definition', id: widgetId });

    // A definition registered under one id but claiming another would build the
    // wrong widget for an arrangement that asked for this one.
    if (definition.id !== widgetId) {
      return err({ kind: 'definition-mismatch', declared: widgetId, actual: definition.id });
    }

    const advanced = createLifecycle().apply('create');
    if (!advanced.ok) return err({ kind: 'lifecycle', id: instanceId, cause: advanced.error });

    this.#instances.set(instanceId, {
      instanceId,
      widgetId,
      manifest,
      definition,
      channel: createEventChannel(),
      lifecycle: advanced.value,
      context: undefined,
      instance: undefined,
    });

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /** Everything the host knows about an instance. */
  snapshot(instanceId: WidgetInstanceId): InstanceSnapshot | undefined {
    const live = this.#instances.get(instanceId);
    if (!live) return undefined;

    return Object.freeze({
      instanceId: live.instanceId,
      widgetId: live.widgetId,
      phase: live.lifecycle.phase,
      surfaceId: live.context?.surfaceId,
      monitorId: live.context?.monitorId,
    });
  }

  /** Every instance, ordered by identity so the list does not wander. */
  instances(): readonly InstanceSnapshot[] {
    return Object.freeze(
      [...this.#instances.keys()]
        .sort()
        .map((id) => this.snapshot(id))
        .filter((entry): entry is InstanceSnapshot => entry !== undefined),
    );
  }

  /** The manifest an instance was built from. */
  manifestOf(instanceId: WidgetInstanceId): WidgetManifest | undefined {
    return this.#instances.get(instanceId)?.manifest;
  }

  /** The view an instance currently wants shown, if it has one. */
  render(instanceId: WidgetInstanceId): Result<TView, HostError> {
    const live = this.#instances.get(instanceId);
    if (!live) return err({ kind: 'unknown-instance', id: instanceId });

    if (!live.instance || !live.context) {
      return err({
        kind: 'lifecycle',
        id: instanceId,
        cause: { kind: 'illegal-transition', from: live.lifecycle.phase, event: 'start' },
      });
    }

    return ok(live.instance.render(live.context));
  }

  /** Destroys every instance, in a fixed order. */
  destroyAll(): void {
    for (const instanceId of [...this.#instances.keys()].sort()) {
      this.destroy(instanceId);
    }
  }

  /**
   * Applies a lifecycle event to an instance.
   *
   * Shared by every transition so the machine is consulted in exactly one place.
   * A transition that the machine refuses does not touch the instance at all.
   */
  protected advance(
    live: LiveInstance<TView>,
    event: WidgetLifecycleEvent,
  ): Result<void, HostError> {
    const next = live.lifecycle.apply(event);
    if (!next.ok) return err({ kind: 'lifecycle', id: live.instanceId, cause: next.error });

    live.lifecycle = next.value;
    return ok(undefined);
  }

  /** Looks up an instance or reports that it is unknown. */
  protected live(instanceId: WidgetInstanceId): Result<LiveInstance<TView>, HostError> {
    const found = this.#instances.get(instanceId);
    return found ? ok(found) : err({ kind: 'unknown-instance', id: instanceId });
  }

  /** Attaches an instance to a surface and builds its context. */
  attach(
    instanceId: WidgetInstanceId,
    placement: SurfacePlacement,
  ): Result<InstanceSnapshot, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    const advanced = this.advance(live, 'attach');
    if (!advanced.ok) return err(advanced.error);

    live.context = createWidgetContext({
      widgetId: live.widgetId,
      instanceId: live.instanceId,
      surfaceId: placement.surfaceId,
      monitorId: placement.monitorId,
      theme: this.#theme,
      events: live.channel,
    });

    // The widget is built now, with a context that is already complete. Building
    // it earlier would mean handing it a context missing the surface it is about
    // to be told to render into.
    live.instance = live.definition.create(live.context);

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /** Starts updating an attached instance. */
  start(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    return this.transition(instanceId, 'start');
  }

  /** Stops updating a running instance, keeping its surface and its context. */
  suspend(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    return this.transition(instanceId, 'suspend', { kind: 'suspended' });
  }

  /** Resumes a suspended instance. */
  resume(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    return this.transition(instanceId, 'resume', { kind: 'resumed' });
  }

  /**
   * Detaches an instance from its surface.
   *
   * The widget instance is discarded, not kept: it was built against a context
   * naming a surface that is no longer this instance's, and reusing it would
   * mean a widget rendering for somewhere it is not. Re-attaching builds a fresh
   * one.
   */
  detach(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    const advanced = this.advance(live, 'detach');
    if (!advanced.ok) return err(advanced.error);

    live.channel.publish({ kind: 'detached' });
    live.instance?.destroy?.();
    live.instance = undefined;
    live.context = undefined;

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /** Destroys an instance and releases everything it held. */
  destroy(instanceId: WidgetInstanceId): Result<void, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    const advanced = this.advance(live, 'destroy');
    if (!advanced.ok) return err(advanced.error);

    live.instance?.destroy?.();
    live.channel.close();
    this.#instances.delete(instanceId);

    return ok(undefined);
  }

  /** Runs a transition that needs no context rebuild. */
  private transition(
    instanceId: WidgetInstanceId,
    event: WidgetLifecycleEvent,
    announce?: WidgetEvent,
  ): Result<InstanceSnapshot, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    const advanced = this.advance(live, event);
    if (!advanced.ok) return err(advanced.error);

    if (announce) live.channel.publish(announce);

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /** The instances currently holding a surface, in identity order. */
  protected attached(): readonly LiveInstance<TView>[] {
    return [...this.#instances.keys()]
      .sort()
      .map((id) => this.#instances.get(id))
      .filter((live): live is LiveInstance<TView> => live !== undefined && hasSurface(live.lifecycle.phase));
    }

  /** Replaces an attached instance's context, and tells it. */
  protected replaceContext(
    live: LiveInstance<TView>,
    next: WidgetContext,
    announce: WidgetEvent,
  ): readonly DeliveryFailure[] {
    live.context = next;
    live.instance?.onEvent?.(announce, next);
    return live.channel.publish(announce);
  }

  /** Rebuilds contexts after something that affects every attached instance. */
  protected rebuildAll(
    change: { readonly theme?: ThemeSnapshot },
    announce: (context: WidgetContext) => WidgetEvent,
  ): HostDelivery {
    const failures: DeliveryFailure[] = [];

    for (const live of this.attached()) {
      if (!live.context) continue;
      const next = withUpdates(live.context, change);
      failures.push(...this.replaceContext(live, next, announce(next)));
    }

    return Object.freeze({ failures: Object.freeze(failures) });
  }

  /** Swaps the theme every future context is built from. */
  protected setTheme(theme: ThemeSnapshot): void {
    this.#theme = theme;
  }

  /** Swaps the registry, for a widget registered after startup. */
  setRegistry(registry: WidgetRegistry): void {
    this.#registry = registry;
  }
}

/** Renders a host failure as something a developer can act on. */
export function describeHostError(error: HostError): string {
  switch (error.kind) {
    case 'unknown-widget':
      return `no widget "${error.id}" is registered`;
    case 'no-definition':
      return `widget "${error.id}" is registered but the host has no code for it`;
    case 'definition-mismatch':
      return `a definition for "${error.actual}" was registered under "${error.declared}"`;
    case 'unknown-instance':
      return `no instance "${error.id}" exists`;
    case 'already-created':
      return `instance "${error.id}" already exists`;
    case 'lifecycle':
      return `${error.id}: ${describeLifecycleError(error.cause)}`;
  }
}
