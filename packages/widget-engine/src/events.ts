/**
 * What a widget can be told, and how.
 *
 * ## Per-instance, never global
 *
 * Each instance gets its own channel. There is no shared bus, no module-level
 * emitter, and no way for one widget to subscribe to another's events — which is
 * `WR-2` (surfaces are isolated) applied to the event path rather than to the
 * DOM. A widget cannot learn that another widget's theme changed, because the
 * only channel it can reach is the one handed to it in its own context.
 *
 * ## Delivery is synchronous and ordered
 *
 * A listener runs before `publish` returns, in subscription order. That makes a
 * theme change and the render that follows it observable as one step in a test,
 * with no scheduling to wait on (`TS-6`: tests depend on no wall-clock time).
 *
 * ## A throwing listener does not stop the others
 *
 * One widget's bad event handler must not prevent a second widget from hearing
 * about a theme change — `AC-ERR-2.2`, failure contained to its own bounds. The
 * error is collected and returned rather than swallowed, so the host can report
 * it and the caller is not left believing delivery was clean.
 */

import type { MonitorId } from '@devdesk/contracts';
import type { ThemeSnapshot } from '@devdesk/theme-engine';

/** Something a widget may be told about. */
export type WidgetEvent =
  /** The resolved theme changed. Carries the new snapshot, never a source. */
  | { readonly kind: 'theme-changed'; readonly theme: ThemeSnapshot }
  /**
   * The surface moved to another display, or lost the one it was on.
   *
   * `undefined` means no display is attached. A widget that shows something
   * display-dependent can stop rather than render against a guess.
   */
  | { readonly kind: 'monitor-changed'; readonly monitorId: MonitorId | undefined }
  /** The widget is no longer being updated. */
  | { readonly kind: 'suspended' }
  /** The widget is being updated again. */
  | { readonly kind: 'resumed' }
  /** The widget has lost its surface and is about to be created-only. */
  | { readonly kind: 'detached' };

/** Receives events. Returns nothing; a widget reacts by re-rendering. */
export type WidgetEventListener = (event: WidgetEvent) => void;

/** Stops a listener receiving further events. Safe to call more than once. */
export type Unsubscribe = () => void;

/** What a widget may do with events. */
export interface WidgetEventChannel {
  readonly subscribe: (listener: WidgetEventListener) => Unsubscribe;
  /** How many listeners are attached. For the host's diagnostics. */
  readonly listenerCount: () => number;
}

/** One listener's failure during delivery. */
export interface DeliveryFailure {
  readonly event: WidgetEvent;
  readonly error: unknown;
}

/** The host's half of a channel: it can publish, a widget cannot. */
export interface WidgetEventPublisher extends WidgetEventChannel {
  /**
   * Delivers to every listener, in subscription order.
   *
   * Returns whatever failed. A throwing listener does not stop delivery to the
   * rest, and its error is not swallowed — the host reports it, and the caller
   * does not get to believe delivery was clean when it was not.
   */
  readonly publish: (event: WidgetEvent) => readonly DeliveryFailure[];
  /** Drops every listener. Called when an instance is destroyed. */
  readonly close: () => void;
}

/**
 * Creates a channel for one widget instance.
 *
 * The publisher and the channel are the same object, and the host hands widgets
 * only the {@link WidgetEventChannel} view of it. That is a structural
 * restriction, not a documented one: a widget's context types the field as the
 * narrow interface, so `publish` is not reachable through it without a cast the
 * reviewer would see.
 */
export function createEventChannel(): WidgetEventPublisher {
  let listeners: WidgetEventListener[] = [];
  let closed = false;

  return Object.freeze({
    subscribe(listener: WidgetEventListener) {
      if (closed) return () => undefined;

      listeners = [...listeners, listener];
      let removed = false;

      return () => {
        // Idempotent: a widget that unsubscribes in a destroy handler and again
        // in a cleanup should not remove a later listener that happens to be
        // equal.
        if (removed) return;
        removed = true;
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners = [...listeners.slice(0, index), ...listeners.slice(index + 1)];
      };
    },

    publish(event: WidgetEvent) {
      if (closed) return Object.freeze([]);

      const failures: DeliveryFailure[] = [];
      // Snapshot first: a listener that subscribes or unsubscribes during
      // delivery must not change who receives *this* event, or delivery order
      // depends on handler side effects.
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          failures.push({ event, error });
        }
      }
      return Object.freeze(failures);
    },

    listenerCount: () => listeners.length,

    close() {
      closed = true;
      listeners = [];
    },
  });
}
