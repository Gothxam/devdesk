/**
 * The execution boundary.
 *
 * Everything a widget cannot do for itself, the host does — and the arrangement
 * is deliberately one-way: the host holds widgets, widgets do not hold the host.
 *
 * ```text
 *  registry ─┐
 *  theme ────┼──▶ WidgetHost ──context + update──▶ pure widget ──▶ view
 *  surfaces ─┘         │
 *                      └── lifecycle, state, coalescing, teardown
 * ```
 *
 * ## What this buys
 *
 * A widget cannot reach `WindowManager`, the platform, a clock, or another
 * widget, because it is never handed anything that could. Its three functions
 * receive a context, a state, and an update; none of those holds a host
 * reference, and this module exports no singleton for a widget to import.
 *
 * ## The host does not decide *when*
 *
 * It records that an instance is dirty and why. Something else — the scheduler —
 * decides when to flush. Splitting it this way is what makes coalescing possible
 * at all: three causes landing before the next flush become one update, and a
 * host that applied each cause as it arrived would have already run the widget
 * three times.
 *
 * ## One instance, one surface, one context, one state
 *
 * The context is built at attach and replaced whenever the theme or the display
 * changes. State is initialised at attach and replaced by `update`. There is
 * neither before attach, because a widget with no surface has nothing to render
 * into and no reason to be computing.
 */

import {
  type MonitorId,
  type SurfaceId,
  type WidgetId,
  type WidgetInstanceId,
  type WidgetManifest,
  widgetOf,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';
import type { ThemeSnapshot } from '@devdesk/theme-engine';

import { createWidgetContext, withUpdates, type WidgetContext } from './context';
import {
  createUpdate,
  type UpdateCadence,
  type WidgetDefinition,
  type WidgetUpdateReason,
} from './definition';
import { createEventChannel, type WidgetEvent, type WidgetEventPublisher } from './events';
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
  | { readonly kind: 'not-attached'; readonly id: WidgetInstanceId }
  | { readonly kind: 'lifecycle'; readonly id: WidgetInstanceId; readonly cause: LifecycleError };

/** What the host knows about one instance, from the outside. */
export interface InstanceSnapshot {
  readonly instanceId: WidgetInstanceId;
  readonly widgetId: WidgetId;
  readonly phase: WidgetPhase;
  readonly surfaceId: SurfaceId | undefined;
  readonly monitorId: MonitorId | undefined;
  /** How often the runtime should update it on its own. */
  readonly cadence: UpdateCadence;
  /** Whether an update is owed. */
  readonly isDirty: boolean;
}

/** The host's internal record. Never handed out. */
interface LiveInstance<TState, TView> {
  readonly instanceId: WidgetInstanceId;
  readonly widgetId: WidgetId;
  readonly manifest: WidgetManifest;
  readonly definition: WidgetDefinition<TState, TView>;
  readonly channel: WidgetEventPublisher;
  lifecycle: WidgetLifecycle;
  context: WidgetContext | undefined;
  state: TState | undefined;
  /** Causes accumulated since the last flush. Coalesced when it happens. */
  pending: Set<WidgetUpdateReason>;
}

/** What a flush did. */
export interface FlushOutcome {
  /** Whether the widget returned a different state. */
  readonly changed: boolean;
  /** The reasons that were coalesced into it. Empty if nothing was owed. */
  readonly reasons: readonly WidgetUpdateReason[];
}

/**
 * Runs widgets.
 *
 * Mutable by design — it is the one place instance state lives — but everything
 * it hands out is immutable, so no caller can reach in and change what it holds.
 */
export class WidgetHost<TState = unknown, TView = unknown> {
  readonly #definitions = new Map<WidgetId, WidgetDefinition<TState, TView>>();
  readonly #instances = new Map<WidgetInstanceId, LiveInstance<TState, TView>>();
  #registry: WidgetRegistry;
  #theme: ThemeSnapshot;

  constructor(registry: WidgetRegistry, theme: ThemeSnapshot) {
    this.#registry = registry;
    this.#theme = theme;
  }

  get theme(): ThemeSnapshot {
    return this.#theme;
  }

  get registry(): WidgetRegistry {
    return this.#registry;
  }

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
  define(definition: WidgetDefinition<TState, TView>): Result<void, HostError> {
    const manifest = this.#registry.lookup(definition.id);
    if (!manifest) return err({ kind: 'unknown-widget', id: definition.id });

    return ok(void this.#definitions.set(definition.id, definition));
  }

  /** Creates an instance. It has no surface, no context, and no state yet. */
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
      state: undefined,
      pending: new Set(),
    });

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /**
   * Attaches an instance to a surface, builds its context, and initialises it.
   *
   * `at` is the runtime's clock. The widget never reads one, so initialisation
   * needs to be told the time like every update does.
   */
  attach(
    instanceId: WidgetInstanceId,
    placement: SurfacePlacement,
    at: number,
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

    // Built now, with a context that is already complete. Initialising earlier
    // would hand it a context missing the surface it is about to render into.
    live.state = live.definition.initialize(live.context, at);
    live.pending = new Set(['attached']);

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /** Starts updating an attached instance. */
  start(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    return this.transition(instanceId, 'start');
  }

  /** Stops updating a running instance, keeping its surface, context, and state. */
  suspend(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    return this.transition(instanceId, 'suspend', { kind: 'suspended' });
  }

  /**
   * Resumes a suspended instance.
   *
   * Marks it dirty with `resumed`, because time passed while it was not
   * updating and whatever it shows is stale by definition.
   */
  resume(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    const resumed = this.transition(instanceId, 'resume', { kind: 'resumed' });
    if (resumed.ok) this.markDirty(instanceId, 'resumed');
    return resumed;
  }

  /**
   * Detaches an instance from its surface.
   *
   * The state is discarded with the context: it was computed against a surface
   * that is no longer this instance's, and keeping it would mean a widget
   * resuming with figures it derived somewhere else.
   */
  detach(instanceId: WidgetInstanceId): Result<InstanceSnapshot, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    const advanced = this.advance(live, 'detach');
    if (!advanced.ok) return err(advanced.error);

    live.channel.publish({ kind: 'detached' });
    live.context = undefined;
    live.state = undefined;
    live.pending = new Set();

    return ok(this.snapshot(instanceId) as InstanceSnapshot);
  }

  /** Destroys an instance and releases everything it held. */
  destroy(instanceId: WidgetInstanceId): Result<void, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    const advanced = this.advance(live, 'destroy');
    if (!advanced.ok) return err(advanced.error);

    live.channel.close();
    this.#instances.delete(instanceId);

    return ok(undefined);
  }

  /** Destroys every instance, in a fixed order. */
  destroyAll(): void {
    for (const instanceId of [...this.#instances.keys()].sort()) {
      this.destroy(instanceId);
    }
  }

  // --------------------------------------------------------------- updates --

  /**
   * Records that an instance owes an update, and why.
   *
   * Does not run the widget. Something else decides when, and the causes
   * accumulate until it does — which is what lets three of them become one call.
   */
  markDirty(instanceId: WidgetInstanceId, reason: WidgetUpdateReason): void {
    const live = this.#instances.get(instanceId);
    if (!live || !hasSurface(live.lifecycle.phase)) return;
    live.pending.add(reason);
  }

  /** Whether an instance owes an update. */
  isDirty(instanceId: WidgetInstanceId): boolean {
    return (this.#instances.get(instanceId)?.pending.size ?? 0) > 0;
  }

  /** The causes an instance has accumulated, in canonical order. */
  pendingReasons(instanceId: WidgetInstanceId): readonly WidgetUpdateReason[] {
    const live = this.#instances.get(instanceId);
    if (!live) return Object.freeze([]);
    return createUpdate(live.pending, 0).reasons;
  }

  /**
   * Runs the widget's `update` with everything it owes, coalesced into one call.
   *
   * A no-op when nothing is owed — the common case for a widget with no cadence
   * on a desktop nobody is touching, and the reason `B-4`'s idle budget is
   * reachable.
   *
   * # Errors
   *
   * Reports an unknown instance and one with no surface. A suspended instance is
   * **not** an error: the scheduler decides whether to flush it, and refusing
   * here would make "suspended" mean two different things in two places.
   */
  flush(instanceId: WidgetInstanceId, at: number): Result<FlushOutcome, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    if (!live.context || live.state === undefined) {
      return err({ kind: 'not-attached', id: instanceId });
    }
    if (live.pending.size === 0) {
      return ok(Object.freeze({ changed: false, reasons: Object.freeze([]) }));
    }

    const update = createUpdate(live.pending, at);
    live.pending = new Set();

    const next = live.definition.update(live.state, update, live.context);
    const changed = next !== live.state;
    live.state = next;

    return ok(Object.freeze({ changed, reasons: update.reasons }));
  }

  /**
   * The view an instance currently wants shown.
   *
   * Renders the state as it stands. It does **not** flush first: rendering is a
   * read, and a read that silently ran the widget would make two calls that
   * describe one moment disagree.
   */
  render(instanceId: WidgetInstanceId): Result<TView, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    if (!live.context || live.state === undefined) {
      return err({ kind: 'not-attached', id: instanceId });
    }

    return ok(live.definition.render(live.state, live.context));
  }

  /** The state an instance holds. For tests and diagnostics. */
  stateOf(instanceId: WidgetInstanceId): TState | undefined {
    return this.#instances.get(instanceId)?.state;
  }

  // ------------------------------------------------------------ propagation --

  /**
   * Adopts a new resolved theme and hands it to every attached widget.
   *
   * Contexts are rebuilt immediately — the snapshot swap is atomic, and a widget
   * that renders during the sweep sees either its old context or its new one,
   * both internally consistent (`AC-THM-3.1`). The *update* is only marked, so a
   * theme change arriving alongside an interval costs one widget call rather
   * than two.
   *
   * Suspended widgets are included. Skipping them would leave one holding the
   * previous theme, so resuming would repaint in the old colours — a flash on
   * exactly the path that exists to avoid one.
   *
   * Re-applying the same theme does nothing, compared by identity first and by
   * content hash otherwise, so a re-resolve triggered by an unrelated change
   * does not tell every widget the theme moved when it did not.
   */
  applyTheme(theme: ThemeSnapshot): readonly WidgetInstanceId[] {
    if (theme === this.#theme || theme.hash === this.#theme.hash) return Object.freeze([]);

    this.#theme = theme;
    const affected: WidgetInstanceId[] = [];

    for (const live of this.attachedInstances()) {
      if (!live.context) continue;
      live.context = withUpdates(live.context, { theme });
      live.pending.add('theme-changed');
      live.channel.publish({ kind: 'theme-changed', theme });
      affected.push(live.instanceId);
    }

    return Object.freeze(affected);
  }

  /**
   * Tells one instance its surface moved to another display, or lost the one it
   * had.
   *
   * Per-instance rather than global because a topology change does not move
   * every surface: one display leaving re-associates the surfaces that were on
   * it and no others, and telling the rest would have every widget recompute for
   * a change that never touched it.
   */
  moveToMonitor(
    instanceId: WidgetInstanceId,
    monitorId: MonitorId | undefined,
  ): Result<boolean, HostError> {
    const found = this.live(instanceId);
    if (!found.ok) return err(found.error);
    const live = found.value;

    if (!live.context) return err({ kind: 'not-attached', id: instanceId });
    if (live.context.monitorId === monitorId) return ok(false);

    live.context = withUpdates(live.context, { monitorId });
    live.pending.add('monitor-changed');
    live.channel.publish({ kind: 'monitor-changed', monitorId });

    return ok(true);
  }

  /** Asks for an update without giving a more specific cause. */
  request(instanceId: WidgetInstanceId): void {
    this.markDirty(instanceId, 'requested');
  }

  // ------------------------------------------------------------- inspection --

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
      cadence: live.definition.cadence,
      isDirty: live.pending.size > 0,
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

  /** The context an instance currently holds, if it has one. */
  contextOf(instanceId: WidgetInstanceId): WidgetContext | undefined {
    return this.#instances.get(instanceId)?.context;
  }

  /** The manifest an instance was built from. */
  manifestOf(instanceId: WidgetInstanceId): WidgetManifest | undefined {
    return this.#instances.get(instanceId)?.manifest;
  }

  /** Swaps the registry, for a widget registered after startup. */
  setRegistry(registry: WidgetRegistry): void {
    this.#registry = registry;
  }

  // --------------------------------------------------------------- internal --

  private live(instanceId: WidgetInstanceId): Result<LiveInstance<TState, TView>, HostError> {
    const found = this.#instances.get(instanceId);
    return found ? ok(found) : err({ kind: 'unknown-instance', id: instanceId });
  }

  private advance(
    live: LiveInstance<TState, TView>,
    event: WidgetLifecycleEvent,
  ): Result<void, HostError> {
    const next = live.lifecycle.apply(event);
    if (!next.ok) return err({ kind: 'lifecycle', id: live.instanceId, cause: next.error });

    live.lifecycle = next.value;
    return ok(undefined);
  }

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

  private attachedInstances(): readonly LiveInstance<TState, TView>[] {
    return [...this.#instances.keys()]
      .sort()
      .map((id) => this.#instances.get(id))
      .filter(
        (live): live is LiveInstance<TState, TView> =>
          live !== undefined && hasSurface(live.lifecycle.phase),
      );
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
    case 'not-attached':
      return `instance "${error.id}" has no surface, so it has no state to update or render`;
    case 'lifecycle':
      return `${error.id}: ${describeLifecycleError(error.cause)}`;
  }
}
