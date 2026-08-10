/**
 * Everything a widget is allowed to know, and the only thing it is handed.
 *
 * ## The whole point is what is *not* here
 *
 * There is no host, no registry, no surface port, no window handle, no monitor
 * object, no theme *source*, no event bus, and no way to reach any of them. A
 * widget that receives a `WidgetContext` can read its own identity, its
 * placement, and the current theme, and it can listen for changes. It cannot
 * create a window, move itself, read another widget's state, or call the
 * platform.
 *
 * That is enforced structurally rather than by convention: the context is the
 * only argument a widget's `create` and `render` ever receive, and it holds no
 * reference to anything that could do those things. There is no ambient module
 * to import either — nothing in this package exposes a singleton, so there is no
 * `getHost()` for a widget to find.
 *
 * ## Immutable, and replaced rather than mutated
 *
 * A context is frozen. When the theme changes, or the surface moves to another
 * display, the host builds a **new** context and hands it over. A widget can
 * therefore hold one across arbitrary work and know that every field it reads
 * describes one consistent moment — the same guarantee `DisplayGraph` gives the
 * layout path (`WD-11`), for the same reason.
 *
 * It also makes change detection free: a widget that keeps the context it last
 * rendered can compare object identity to know whether anything moved.
 *
 * ## Why the theme is a snapshot
 *
 * A `ThemeSnapshot` is a resolved, frozen set of token values. A `ThemeSource`
 * is the unresolved document it came from — with references, cascades, and
 * modes still to apply. Handing widgets the source would mean every widget
 * resolves tokens itself, which is N implementations of the cascade, N chances
 * to disagree, and N places to fix a bug in it. The engine resolves once; every
 * widget sees the answer.
 */

import type { MonitorId, SurfaceId, WidgetId, WidgetInstanceId } from '@devdesk/contracts';
import type { ThemeSnapshot } from '@devdesk/theme-engine';

import type { WidgetEventChannel } from './events';

/** What a widget knows about itself and where it is. */
export interface WidgetContext {
  /** The kind of widget this is. */
  readonly widgetId: WidgetId;
  /** Which placement of that widget this is. Survives a restart. */
  readonly instanceId: WidgetInstanceId;
  /** The surface it is attached to. A context exists only once attached. */
  readonly surfaceId: SurfaceId;
  /**
   * The display its surface is currently on.
   *
   * `undefined` when no display is attached — a closed lid with nothing plugged
   * in. That is a real state, not an error, and a widget that renders
   * differently without a display can say so rather than guess.
   */
  readonly monitorId: MonitorId | undefined;
  /** The resolved theme. Never a source (see above). */
  readonly theme: ThemeSnapshot;
  /** Changes the widget may listen for. Scoped to this instance. */
  readonly events: WidgetEventChannel;
}

/** The fields a caller supplies; the rest of a context is derived. */
export interface WidgetContextInit {
  readonly widgetId: WidgetId;
  readonly instanceId: WidgetInstanceId;
  readonly surfaceId: SurfaceId;
  readonly monitorId: MonitorId | undefined;
  readonly theme: ThemeSnapshot;
  readonly events: WidgetEventChannel;
}

/** Builds a frozen context. */
export function createWidgetContext(init: WidgetContextInit): WidgetContext {
  return Object.freeze({
    widgetId: init.widgetId,
    instanceId: init.instanceId,
    surfaceId: init.surfaceId,
    monitorId: init.monitorId,
    theme: init.theme,
    events: init.events,
  });
}

/**
 * Builds the next context from the current one, changing only what is given.
 *
 * Identity, surface, and event channel are not changeable through here: a widget
 * that moved surface has detached and re-attached, which produces a new context
 * from scratch rather than an edited one. Allowing a surface swap in place would
 * let a widget's context disagree with its lifecycle phase.
 */
export function withUpdates(
  context: WidgetContext,
  changes: {
    readonly theme?: ThemeSnapshot;
    readonly monitorId?: MonitorId | undefined;
  },
): WidgetContext {
  return Object.freeze({
    widgetId: context.widgetId,
    instanceId: context.instanceId,
    surfaceId: context.surfaceId,
    monitorId: 'monitorId' in changes ? changes.monitorId : context.monitorId,
    theme: changes.theme ?? context.theme,
    events: context.events,
  });
}
