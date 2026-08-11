/**
 * The session activity log: what this runtime actually did.
 *
 * ## Every entry is a real event
 *
 * The controller records what happened — a widget placed, the theme switched,
 * the display changed, the first frame presented — each stamped with the
 * runtime clock at the moment it occurred. Nothing here is sample text, and
 * there is no seeded history: a session that has just started shows the two or
 * three things it has genuinely done.
 *
 * An empty log renders as empty. That is the honest state for a runtime that
 * has not done anything yet, and inventing a plausible-looking history to fill
 * the card would make the widget useless for the one thing a log is for.
 */

import { widgetId } from '@devdesk/contracts';
import { everyMs, type WidgetContext, type WidgetUpdate } from '@devdesk/widget-engine';

import type { ActivitySnapshot, Feed } from './feeds';
import {
  expectState,
  hhmm,
  movesTime,
  type DesktopWidgetDefinition,
  type DesktopWidgetState,
} from './state';
import { envelope, type DesktopWidgetView } from './view';

/**
 * Two seconds.
 *
 * The log is push-shaped — the controller requests an update when it records
 * something — so the cadence is only a backstop for a request that was
 * throttled. Fast enough that the card is never visibly stale, slow enough that
 * an idle desktop is not paying for a log nothing is writing to.
 */
export const ACTIVITY_CADENCE_MS = 2_000;

export const ACTIVITY_MANIFEST = Object.freeze({
  id: 'devdesk.activity',
  name: 'Session Log',
  version: '1.0.0',
  description: 'What this session has done, as it happens.',
  capabilities: [],
  preferredSize: { width: 300, height: 220 },
});

/** How the log describes itself when it has nothing to show. */
const NOTHING_YET = 'no activity yet';

/** Builds the definition against a feed the controller owns. */
export function createActivityWidget(feed: Feed<ActivitySnapshot>): DesktopWidgetDefinition {
  return Object.freeze({
    id: (() => {
      const parsed = widgetId(ACTIVITY_MANIFEST.id);
      if (!parsed.ok) throw new Error('the activity widget id must be valid');
      return parsed.value;
    })(),

    cadence: everyMs(ACTIVITY_CADENCE_MS),

    initialize(_context: WidgetContext, at: number): DesktopWidgetState {
      const snapshot = feed();
      return Object.freeze({
        kind: 'activity',
        entries: snapshot.entries,
        total: snapshot.total,
        at,
      });
    },

    update(raw: DesktopWidgetState, update: WidgetUpdate): DesktopWidgetState {
      const state = expectState(raw, 'activity');
      if (!movesTime(update.reasons)) return state;

      const snapshot = feed();
      // The controller swaps one frozen value for another, so identity is a
      // sound test for "nothing was recorded since last time" — and returning
      // the same state tells the runtime to skip the render.
      if (snapshot.entries === state.entries && snapshot.total === state.total) return state;

      return Object.freeze({
        kind: 'activity',
        entries: snapshot.entries,
        total: snapshot.total,
        at: update.at,
      });
    },

    render(raw: DesktopWidgetState, context: WidgetContext): DesktopWidgetView {
      const state = expectState(raw, 'activity');
      const newest = state.entries[0];

      return Object.freeze({
        ...envelope(context, {
          kind: 'activity',
          title: 'Session Log',
          // The newest event is the headline. A log's most useful line is its
          // last one, and a card that showed a count would make the user open
          // something to find out what happened.
          time: newest ? newest.message : NOTHING_YET,
          date: newest
            ? `${hhmm(newest.at)} · ${state.total} event${state.total === 1 ? '' : 's'}`
            : 'this session',
        }),
        activity: Object.freeze({ entries: state.entries, total: state.total }),
      });
    },
  });
}
