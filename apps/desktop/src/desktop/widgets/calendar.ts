/**
 * The calendar: the current month, with today marked.
 *
 * Every date is computed from the time the runtime supplies, so it is correct
 * on any day, in any month, in any year, and it rolls over at midnight without
 * anyone arranging for that.
 *
 * ## Cadence
 *
 * A minute. A calendar changes once a day but has to *notice* at midnight, and
 * the cheapest way to notice within a minute is to be asked every minute. The
 * update returns its own state unchanged on 1439 of those, so the runtime skips
 * the render for all but one.
 */

import { widgetId } from '@devdesk/contracts';
import { everyMs, type WidgetContext, type WidgetUpdate } from '@devdesk/widget-engine';

import {
  expectState,
  movesTime,
  type DesktopWidgetDefinition,
  type DesktopWidgetState,
} from './state';
import { envelope, type CalendarCell, type DesktopWidgetView } from './view';

export const CALENDAR_CADENCE_MS = 60_000;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Monday first: the working week is what a desktop calendar is read against. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CALENDAR_MANIFEST = Object.freeze({
  id: 'devdesk.calendar',
  name: 'Calendar',
  version: '1.0.0',
  description: 'The current month, with today marked.',
  capabilities: [],
  preferredSize: { width: 300, height: 300 },
});

/** Local midnight of whatever day `at` falls in. */
function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 0 for Monday … 6 for Sunday. `Date` counts from Sunday; the grid does not. */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * Six weeks of seven days covering the month `dayStart` falls in.
 *
 * Always six rows. A month needing only five would make the widget change
 * height between February and March, and a desktop widget that resizes itself
 * as the calendar turns has to be re-laid-out for no reason the user can see.
 */
function buildWeeks(dayStart: number): readonly (readonly CalendarCell[])[] {
  const today = new Date(dayStart);
  const year = today.getFullYear();
  const month = today.getMonth();
  const todayDate = today.getDate();

  const cursor = new Date(year, month, 1 - mondayIndex(new Date(year, month, 1)));
  const weeks: CalendarCell[][] = [];

  for (let week = 0; week < 6; week += 1) {
    const days: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const isCurrentMonth = cursor.getMonth() === month && cursor.getFullYear() === year;
      days.push(
        Object.freeze({
          day: cursor.getDate(),
          isToday: isCurrentMonth && cursor.getDate() === todayDate,
          isCurrentMonth,
          isWeekend: day >= 5,
        }),
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
  }

  return Object.freeze(weeks.map((week) => Object.freeze(week)));
}

export const CALENDAR_WIDGET: DesktopWidgetDefinition = Object.freeze({
  id: (() => {
    const parsed = widgetId(CALENDAR_MANIFEST.id);
    if (!parsed.ok) throw new Error('the calendar widget id must be valid');
    return parsed.value;
  })(),

  cadence: everyMs(CALENDAR_CADENCE_MS),

  initialize(_context: WidgetContext, at: number): DesktopWidgetState {
    return Object.freeze({ kind: 'calendar', dayStart: startOfDay(at) });
  },

  update(raw: DesktopWidgetState, update: WidgetUpdate): DesktopWidgetState {
    const state = expectState(raw, 'calendar');
    if (!movesTime(update.reasons)) return state;

    const next = startOfDay(update.at);
    return next === state.dayStart ? state : Object.freeze({ kind: 'calendar', dayStart: next });
  },

  render(raw: DesktopWidgetState, context: WidgetContext): DesktopWidgetView {
    const state = expectState(raw, 'calendar');
    const today = new Date(state.dayStart);
    const weeks = buildWeeks(state.dayStart);

    return Object.freeze({
      ...envelope(context, {
        kind: 'calendar',
        title: 'Calendar',
        time: `${MONTHS[today.getMonth()]}`,
        date: `${WEEKDAYS[mondayIndex(today)]} ${today.getDate()} · ${today.getFullYear()}`,
      }),
      calendar: Object.freeze({
        monthLabel: `${MONTHS[today.getMonth()]} ${today.getFullYear()}`,
        weekdays: WEEKDAYS,
        weeks,
      }),
    });
  },
});
