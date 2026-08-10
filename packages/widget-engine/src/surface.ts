/**
 * How a widget reaches a surface.
 *
 * ## The one door out of this package
 *
 * A surface is created by the Rust core, and the core is reached over IPC. This
 * package has no Tauri import and no knowledge of the contract — instead it
 * declares a {@link SurfacePort}, and the host application implements it.
 *
 * That indirection earns three things:
 *
 * 1. **The runtime is testable without a host.** Every test in this package runs
 *    against a fake port, in Node, with no Tauri and no window.
 * 2. **Widgets cannot reach the window subsystem.** They never see the port —
 *    it belongs to the binder, and a widget's context does not carry it.
 * 3. **The IPC surface stays visible.** Everything crossing the trust boundary
 *    is on one interface, so a review of what the shell can ask the core to do
 *    is a review of one file.
 *
 * ## A surface identity *is* a widget instance identity
 *
 * Both must survive a restart, and both name the same thing: this widget, in
 * this place. Deriving one from the other would mean maintaining a mapping that
 * can only ever be wrong, and storing both would mean two things to keep in
 * step. So there is one string, and {@link SurfacePort.acquire} takes the
 * instance identity directly.
 *
 * ## Ordering is the whole point
 *
 * ```text
 *  create ─▶ acquire ─▶ attach ─▶ start ─▶ (the shell paints) ─▶ reportPainted
 *            hidden      widget    running                        revealed
 * ```
 *
 * The core creates the window hidden and reveals it only when told the content
 * has painted (`AC-FRE-1.1`). This package cannot know when pixels landed — only
 * the renderer can — so {@link WidgetSurfaceBinder.reportPainted} is a separate
 * call the shell makes, rather than something inferred here.
 */

import type { MonitorId, SurfaceId, WidgetInstanceId } from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';

import type { HostError, InstanceSnapshot, SurfacePlacement, WidgetHost } from './host';

/** Why the core refused. */
export type SurfacePortError =
  | { readonly kind: 'already-registered'; readonly surfaceId: SurfaceId }
  | { readonly kind: 'not-found'; readonly surfaceId: SurfaceId }
  | { readonly kind: 'refused'; readonly detail: string };

/**
 * The core, as this package needs it.
 *
 * Asynchronous because IPC is. A synchronous shape would be a lie that showed up
 * as a deadlock the first time it was implemented against a real transport.
 */
export interface SurfacePort {
  /**
   * Registers a surface and has its window created hidden.
   *
   * Takes the widget instance identity, which *is* the surface identity.
   */
  readonly acquire: (
    instanceId: WidgetInstanceId,
  ) => Promise<Result<SurfacePlacement, SurfacePortError>>;

  /** Tells the core the content has painted, which reveals the window. */
  readonly reportPainted: (surfaceId: SurfaceId) => Promise<Result<void, SurfacePortError>>;

  /** Removes the surface and destroys its window. */
  readonly release: (surfaceId: SurfaceId) => Promise<Result<void, SurfacePortError>>;
}

/** Why placing or removing a widget failed. */
export type BindingError =
  | { readonly kind: 'host'; readonly cause: HostError }
  | { readonly kind: 'port'; readonly cause: SurfacePortError };

/**
 * Drives a widget from nothing to running on a surface, and back.
 *
 * The host owns lifecycle; the port owns surfaces; this owns the *order* they
 * happen in, which is where the mistakes are. Keeping the order in one place
 * means the reveal sequence is written once rather than at every call site that
 * places a widget.
 */
export class WidgetSurfaceBinder<TState, TView> {
  readonly #host: WidgetHost<TState, TView>;
  readonly #port: SurfacePort;

  constructor(host: WidgetHost<TState, TView>, port: SurfacePort) {
    this.#host = host;
    this.#port = port;
  }

  /**
   * Places a widget: creates it, gets it a hidden surface, attaches, and starts.
   *
   * It is **not** revealed. The window exists and is hidden, the widget is
   * running and producing views, and the shell reveals it by calling
   * {@link WidgetSurfaceBinder.reportPainted} once it has actually drawn.
   *
   * A failure after the surface was acquired releases it before returning.
   * Leaving it would strand a hidden window belonging to a widget that does not
   * exist — invisible, unreachable, and permanent, which is the same orphan the
   * core's own registration rollback exists to prevent.
   */
  async place(
    instanceId: WidgetInstanceId,
    at: number,
  ): Promise<Result<InstanceSnapshot, BindingError>> {
    const created = this.#host.create(instanceId);
    if (!created.ok) return err({ kind: 'host', cause: created.error });

    const acquired = await this.#port.acquire(instanceId);
    if (!acquired.ok) {
      this.#host.destroy(instanceId);
      return err({ kind: 'port', cause: acquired.error });
    }

    const attached = this.#host.attach(instanceId, acquired.value, at);
    if (!attached.ok) {
      await this.#port.release(acquired.value.surfaceId);
      this.#host.destroy(instanceId);
      return err({ kind: 'host', cause: attached.error });
    }

    const started = this.#host.start(instanceId);
    if (!started.ok) {
      await this.#port.release(acquired.value.surfaceId);
      this.#host.destroy(instanceId);
      return err({ kind: 'host', cause: started.error });
    }

    return ok(started.value);
  }

  /**
   * Tells the core the widget has drawn, revealing its window.
   *
   * Separate from {@link WidgetSurfaceBinder.place} because this package cannot
   * observe a frame. Inferring it — from a timer, or from `place` returning —
   * is how the flash `AC-FRE-1.1` forbids gets reintroduced by the layer that
   * was supposed to prevent it.
   */
  async reportPainted(instanceId: WidgetInstanceId): Promise<Result<void, BindingError>> {
    const context = this.#host.contextOf(instanceId);
    if (!context) {
      return err({ kind: 'host', cause: { kind: 'unknown-instance', id: instanceId } });
    }

    const reported = await this.#port.reportPainted(context.surfaceId);
    return reported.ok ? ok(undefined) : err({ kind: 'port', cause: reported.error });
  }

  /**
   * Moves a widget to another surface.
   *
   * Detach, release, acquire, attach, start — in that order, with the old
   * surface gone before the new one is asked for. Acquiring first would leave
   * two surfaces for one widget if the second step failed, and the extra one
   * would be a hidden window nothing refers to.
   *
   * The widget is rebuilt rather than moved: it was created against a context
   * naming the old surface.
   */
  async moveToNewSurface(
    instanceId: WidgetInstanceId,
    at: number,
  ): Promise<Result<InstanceSnapshot, BindingError>> {
    const context = this.#host.contextOf(instanceId);
    if (!context) {
      return err({ kind: 'host', cause: { kind: 'unknown-instance', id: instanceId } });
    }

    const detached = this.#host.detach(instanceId);
    if (!detached.ok) return err({ kind: 'host', cause: detached.error });

    await this.#port.release(context.surfaceId);

    const acquired = await this.#port.acquire(instanceId);
    if (!acquired.ok) return err({ kind: 'port', cause: acquired.error });

    const attached = this.#host.attach(instanceId, acquired.value, at);
    if (!attached.ok) {
      await this.#port.release(acquired.value.surfaceId);
      return err({ kind: 'host', cause: attached.error });
    }

    const started = this.#host.start(instanceId);
    return started.ok ? ok(started.value) : err({ kind: 'host', cause: started.error });
  }

  /**
   * Removes a widget and its surface.
   *
   * The widget is destroyed whether or not the core could release the surface,
   * for the same reason the core removes a surface whether or not its window
   * could be destroyed: the caller asked for it to be gone, and keeping it would
   * resurrect it on the next arrangement restore.
   */
  async remove(instanceId: WidgetInstanceId): Promise<Result<void, BindingError>> {
    const context = this.#host.contextOf(instanceId);
    const surfaceId: SurfaceId | undefined = context?.surfaceId;

    if (context) this.#host.detach(instanceId);

    const destroyed = this.#host.destroy(instanceId);
    if (surfaceId) await this.#port.release(surfaceId);

    return destroyed.ok ? ok(undefined) : err({ kind: 'host', cause: destroyed.error });
  }

  /** The display a placed widget is currently on. */
  monitorOf(instanceId: WidgetInstanceId): MonitorId | undefined {
    return this.#host.contextOf(instanceId)?.monitorId;
  }
}

/** Renders a binding failure as something a developer can act on. */
export function describeBindingError(
  error: BindingError,
  describeHost: (cause: HostError) => string,
): string {
  if (error.kind === 'host') return describeHost(error.cause);

  switch (error.cause.kind) {
    case 'already-registered':
      return `the core already has a surface "${error.cause.surfaceId}"`;
    case 'not-found':
      return `the core has no surface "${error.cause.surfaceId}"`;
    case 'refused':
      return `the core refused: ${error.cause.detail}`;
  }
}
