/**
 * What a widget author writes.
 *
 * ## A widget is three pure functions
 *
 * ```text
 *  initialize(context, at) ─▶ state
 *  update(state, update, context) ─▶ state
 *  render(state, context) ─▶ view
 * ```
 *
 * None of them may read a clock, start a timer, touch the DOM, or perform IO.
 * The runtime supplies the time on every update; the runtime decides when an
 * update happens; the runtime turns the view into pixels.
 *
 * That is not tidiness. Three things follow from it that are otherwise
 * impossible:
 *
 * 1. **A widget's whole behaviour is testable by calling functions.** Feeding
 *    `update` a sequence of reasons and timestamps and asserting the views is
 *    the entire test, with no renderer, no DOM, no waiting, and no flake.
 * 2. **Periodic work is accountable.** A widget that owned a `setInterval`
 *    would keep running when hidden, when suspended, and when its display was
 *    unplugged, and `B-4`'s idle budget would be spent by code nobody could
 *    see. The runtime owns the cadence, so it can decline to run it.
 * 3. **Coalescing is possible at all.** Three things changing before the next
 *    flush become one `update` call, which a widget driving itself could not
 *    do because it would already have run.
 *
 * ## Renderer-agnostic
 *
 * A widget produces a **view model** — a plain value describing what it wants
 * shown — and something else turns that into pixels. The runtime never imports
 * React, never touches the DOM, and never knows what a component is. A widget
 * that never receives a DOM node cannot traverse out of one, which is `WR-2`
 * enforced by what a widget is handed rather than by review.
 */

import type { WidgetId } from '@devdesk/contracts';

import type { WidgetContext } from './context';

/**
 * Why the runtime is updating a widget.
 *
 * Carried rather than inferred, because a widget usually wants to do different
 * work for different causes: a clock recomputes the time on `interval` and does
 * not need to on `theme-changed`, and doing both for both is how a cheap widget
 * becomes an expensive one.
 */
export type WidgetUpdateReason =
  /** The first update, immediately after attaching. */
  | 'attached'
  /** The widget's declared cadence elapsed. */
  | 'interval'
  /** The resolved theme changed. */
  | 'theme-changed'
  /** The surface moved to another display, or lost the one it had. */
  | 'monitor-changed'
  /** The widget was suspended and is being updated again. */
  | 'resumed'
  /** Something asked for an update explicitly. */
  | 'requested';

/** Every reason, in the order they are reported when coalesced. */
export const WIDGET_UPDATE_REASONS: readonly WidgetUpdateReason[] = Object.freeze([
  'attached',
  'resumed',
  'theme-changed',
  'monitor-changed',
  'interval',
  'requested',
]);

/**
 * One update pass.
 *
 * `reasons` is a set rather than a single value because updates coalesce: a
 * theme change, a display change, and an elapsed interval landing in the same
 * frame produce **one** call carrying all three. A widget that only cares about
 * one of them checks for it; a widget that recomputes everything ignores the
 * field entirely.
 */
export interface WidgetUpdate {
  /** Deduplicated, in {@link WIDGET_UPDATE_REASONS} order. Never empty. */
  readonly reasons: readonly WidgetUpdateReason[];
  /**
   * The runtime's clock, in milliseconds.
   *
   * **The only time a widget may use.** Reading a clock inside `update` would
   * make it impure, make two widgets updated in one pass disagree about when
   * "now" is, and make every test depend on a wall clock (`TS-6`).
   */
  readonly at: number;
}

/** Whether an update happened for a particular reason. */
export function hasReason(update: WidgetUpdate, reason: WidgetUpdateReason): boolean {
  return update.reasons.includes(reason);
}

/**
 * Builds an update from a set of reasons.
 *
 * Deduplicates and orders, so two updates carrying the same causes compare
 * equal regardless of the order the causes arrived in.
 */
export function createUpdate(
  reasons: Iterable<WidgetUpdateReason>,
  at: number,
): WidgetUpdate {
  const present = new Set(reasons);
  return Object.freeze({
    reasons: Object.freeze(WIDGET_UPDATE_REASONS.filter((reason) => present.has(reason))),
    at,
  });
}

/** How often the runtime should update a widget on its own. */
export type UpdateCadence =
  /**
   * Never on a timer.
   *
   * The widget is still updated when its context changes — a theme switch, a
   * display change — because those are not periodic work.
   */
  | { readonly kind: 'none' }
  /**
   * Every `everyMs`, while the widget is running and visible.
   *
   * A request, not a guarantee. The scheduler may run it late under throttling,
   * and will not run it at all while the widget is suspended.
   */
  | { readonly kind: 'interval'; readonly everyMs: number };

/** Never on a timer. */
export const NO_CADENCE: UpdateCadence = Object.freeze({ kind: 'none' });

/** Every `everyMs` while running and visible. */
export function everyMs(interval: number): UpdateCadence {
  return Object.freeze({ kind: 'interval', everyMs: Math.max(1, Math.floor(interval)) });
}

/**
 * What a widget author registers with the runtime.
 *
 * Generic over both its state and its view. The runtime treats each as opaque
 * and only ever passes them along — it never inspects state, and never renders a
 * view.
 */
export interface WidgetDefinition<TState = unknown, TView = unknown> {
  /** Must match the id in the manifest, and the host checks that it does. */
  readonly id: WidgetId;

  /**
   * How often the runtime should update this widget on its own.
   *
   * Declared here rather than in the manifest because it is a property of the
   * implementation, not of the contract: a widget could change how often it
   * recomputes without its manifest — and therefore its published version —
   * changing at all.
   */
  readonly cadence: UpdateCadence;

  /**
   * Builds the first state.
   *
   * Pure. `at` is the runtime's clock; there is no other source of time.
   */
  readonly initialize: (context: WidgetContext, at: number) => TState;

  /**
   * Produces the next state.
   *
   * Pure: the same state, update, and context must always produce the same
   * result. The runtime reserves the right to call it more than once for one
   * change, and a widget that counted calls would drift.
   *
   * Returning the state it was given tells the runtime nothing changed, which
   * lets it skip the render.
   */
  readonly update: (state: TState, update: WidgetUpdate, context: WidgetContext) => TState;

  /**
   * Produces what should be shown.
   *
   * Pure, and derived from state and context alone. A render that read anything
   * else would produce output the state could not explain, which is the thing
   * that makes a UI bug irreproducible.
   */
  readonly render: (state: TState, context: WidgetContext) => TView;
}
