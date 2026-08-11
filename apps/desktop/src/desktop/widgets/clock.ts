/**
 * The clock.
 *
 * Three pure functions and no clock of its own: every `update` is handed `at`
 * by the runtime, and that is the only time it may use. Its whole behaviour is
 * a table — feed `update` a sequence of reasons and timestamps, assert the
 * views — and its periodic work is the runtime's to decline when the desktop is
 * hidden (`B-4`).
 */

import { widgetId } from '@devdesk/contracts';
import { everyMs, type WidgetContext, type WidgetUpdate } from '@devdesk/widget-engine';

import {
  expectState,
  movesTime,
  two,
  type DesktopWidgetDefinition,
  type DesktopWidgetState,
} from './state';
import { envelope, type DesktopWidgetView } from './view';

export const CLOCK_CADENCE_MS = 1_000;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const CLOCK_MANIFEST = Object.freeze({
  id: 'devdesk.clock',
  name: 'Clock',
  version: '1.0.0',
  description: 'The current time.',
  capabilities: [],
  preferredSize: { width: 300, height: 168 },
});

export const CLOCK_WIDGET: DesktopWidgetDefinition = Object.freeze({
  id: (() => {
    const parsed = widgetId(CLOCK_MANIFEST.id);
    if (!parsed.ok) throw new Error('the clock widget id must be valid');
    return parsed.value;
  })(),

  // A second. More would burn the idle budget to change a digit that moves once
  // a minute; less would show a stale minute for up to that long after it turned.
  cadence: everyMs(CLOCK_CADENCE_MS),

  initialize(_context: WidgetContext, at: number): DesktopWidgetState {
    return Object.freeze({ kind: 'clock', at });
  },

  update(raw: DesktopWidgetState, update: WidgetUpdate): DesktopWidgetState {
    const state = expectState(raw, 'clock');
    if (!movesTime(update.reasons)) return state;

    // Minute resolution: the face shows HH:MM, so a new second that lands in
    // the same minute changes nothing anyone can see. Returning the same object
    // tells the runtime to skip the render — true 59 times out of 60.
    const shown = Math.floor(state.at / 60_000);
    const now = Math.floor(update.at / 60_000);
    return shown === now ? state : Object.freeze({ kind: 'clock', at: update.at });
  },

  render(raw: DesktopWidgetState, context: WidgetContext): DesktopWidgetView {
    const state = expectState(raw, 'clock');
    const at = new Date(state.at);

    return envelope(context, {
      kind: 'clock',
      title: 'Clock',
      time: `${two(at.getHours())}:${two(at.getMinutes())}`,
      date: `${DAYS[at.getDay()]}, ${at.getDate()} ${MONTHS[at.getMonth()]}`,
    });
  },
});
