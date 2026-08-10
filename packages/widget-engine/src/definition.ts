/**
 * What a widget author writes.
 *
 * ## Renderer-agnostic on purpose
 *
 * A widget produces a **view model** — a plain value describing what it wants
 * shown — and something else turns that into pixels. The runtime never imports
 * React, never touches the DOM, and never knows what a component is.
 *
 * Three things follow from that, and all three matter more than the small
 * indirection costs:
 *
 * 1. **Widget logic is testable in Node.** A clock's behaviour across a theme
 *    change, a suspend, and a display loss is asserted by calling `render` and
 *    reading the result, with no renderer and no DOM.
 * 2. **The renderer can change.** React is the shell's choice, not the widget
 *    contract's, and a widget written today does not have to be rewritten if
 *    that changes.
 * 3. **A widget cannot reach the document.** `WR-2` requires surface isolation.
 *    A widget that never receives a DOM node cannot traverse out of one.
 *
 * ## The view type is the widget's own
 *
 * `WidgetDefinition` is generic over it. A clock returns something clock-shaped;
 * whoever renders a clock knows that shape. The runtime treats it as opaque and
 * only ever passes it along.
 */

import type { WidgetId } from '@devdesk/contracts';

import type { WidgetContext } from './context';
import type { WidgetEvent } from './events';

/**
 * One live widget.
 *
 * Created once per attachment, discarded on detach or destroy.
 */
export interface WidgetInstance<TView> {
  /**
   * Produces what should be shown, from the context and nothing else.
   *
   * Called whenever the host has reason to believe the output may have changed:
   * after an event, and whenever the caller asks. It **should** be free of side
   * effects — the same context should produce the same view — because the host
   * reserves the right to call it more than once for one change, and a widget
   * that counted renders would drift.
   */
  readonly render: (context: WidgetContext) => TView;

  /**
   * Reacts to something that happened.
   *
   * Optional: a widget whose output depends only on the context does not need
   * it, because the host re-renders with the new context anyway.
   */
  readonly onEvent?: (event: WidgetEvent, context: WidgetContext) => void;

  /**
   * Releases anything the instance holds.
   *
   * The host unsubscribes the event channel itself, so this is only for what the
   * widget acquired on its own — a timer, most often.
   */
  readonly destroy?: () => void;
}

/** What a widget author registers with the runtime. */
export interface WidgetDefinition<TView = unknown> {
  /** Must match the id in the manifest, and the host checks that it does. */
  readonly id: WidgetId;

  /**
   * Builds an instance for one attachment.
   *
   * Receives the context and nothing else. There is deliberately no second
   * argument carrying "the host" or "the platform": a widget's whole world is
   * its context, and there is no ambient module to import instead.
   */
  readonly create: (context: WidgetContext) => WidgetInstance<TView>;
}
