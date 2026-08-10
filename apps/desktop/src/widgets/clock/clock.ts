/**
 * The clock widget.
 *
 * ## Why a clock is the first widget
 *
 * Not because clocks matter. Because it is the smallest thing that exercises
 * every part of the runtime at once: a manifest to validate, an identity that
 * persists, a lifecycle to walk, a theme to read, a surface to attach to, a
 * declared cadence, and a reason to catch up after a suspension. A widget
 * showing static text would leave most of that untested.
 *
 * ## Three pure functions and no clock
 *
 * The widget never reads the time. Every `update` is handed `at` by the runtime,
 * and that is the only time it may use. Two consequences, both of which are the
 * point of Stage 3.5:
 *
 * - **Its whole behaviour is a table.** Feed `update` a sequence of reasons and
 *   timestamps, assert the views. No renderer, no DOM, no waiting, no flake.
 * - **Its periodic work is the runtime's to decline.** A clock that owned a
 *   `setInterval` would keep ticking while hidden, while suspended, and while
 *   its display was unplugged, and `B-4`'s idle budget would be spent by code
 *   nobody could see.
 *
 * ## It reads the theme, it does not style itself
 *
 * The view carries token *values* read from the snapshot in the context. The
 * widget emits no CSS, touches no custom property, and never decides what a
 * colour should be.
 */

import { widgetId } from '@devdesk/contracts';
import { tokenId, type ThemeSnapshot } from '@devdesk/theme-engine';
import {
  everyMs,
  hasReason,
  type WidgetContext,
  type WidgetDefinition,
  type WidgetUpdate,
} from '@devdesk/widget-engine';

/**
 * Everything the clock remembers.
 *
 * One number. The formatting is derived in `render`, not stored, because a
 * stored string would be a second representation of the same fact and the two
 * would eventually disagree.
 */
export interface ClockState {
  /** The moment the clock is showing, as milliseconds since the epoch. */
  readonly at: number;
}

/** What the clock wants shown. A plain value; the shell turns it into pixels. */
export interface ClockView {
  /** `HH:MM`, in the machine's local time. */
  readonly time: string;
  /** The day, as a short human string. */
  readonly date: string;
  /** The resolved accent colour. Read from the theme, never chosen here. */
  readonly accent: string;
  /** The resolved foreground colour. */
  readonly foreground: string;
  /**
   * Whether the surface currently has a display.
   *
   * A clock with nowhere to be shown still knows the time; this lets the shell
   * decide what that should look like rather than the widget guessing.
   */
  readonly hasDisplay: boolean;
}

/** How often the clock asks to be updated. */
export const CLOCK_CADENCE_MS = 1_000;

const ACCENT = tokenId('color.accent');
const FOREGROUND = tokenId('color.ink');

/** Reads a token, falling back to something visible rather than to nothing. */
function read(theme: ThemeSnapshot, id: ReturnType<typeof tokenId>, fallback: string): string {
  return theme.tokens.get(id) ?? fallback;
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** The clock, as the runtime consumes it. */
export const CLOCK_WIDGET: WidgetDefinition<ClockState, ClockView> = Object.freeze({
  id: (() => {
    const parsed = widgetId('devdesk.clock');
    if (!parsed.ok) throw new Error('the clock widget id must be valid');
    return parsed.value;
  })(),

  // A second. Asking for more would burn the idle budget to change a digit that
  // moves once a minute; asking for less would show a stale minute for up to
  // that long after it turned.
  cadence: everyMs(CLOCK_CADENCE_MS),

  initialize(_context: WidgetContext, at: number): ClockState {
    return Object.freeze({ at });
  },

  update(state: ClockState, update: WidgetUpdate): ClockState {
    // Only the causes that move time. A theme change does not change what the
    // clock reads, and recomputing for it would make a cheap widget expensive
    // on a path that has nothing to do with it.
    const movesTime =
      hasReason(update, 'interval') ||
      hasReason(update, 'resumed') ||
      hasReason(update, 'requested');

    if (!movesTime) return state;

    // Returning the same object tells the runtime nothing changed, which lets it
    // skip the render. Within one second that is the common case.
    return update.at === state.at ? state : Object.freeze({ at: update.at });
  },

  render(state: ClockState, context: WidgetContext): ClockView {
    const at = new Date(state.at);

    return Object.freeze({
      time: `${two(at.getHours())}:${two(at.getMinutes())}`,
      date: `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`,
      accent: read(context.theme, ACCENT, '#7aa2ff'),
      foreground: read(context.theme, FOREGROUND, '#f2f4f8'),
      hasDisplay: context.monitorId !== undefined,
    });
  },
});
