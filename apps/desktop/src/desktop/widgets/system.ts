/**
 * The system readout: what this runtime can honestly say about itself.
 *
 * ## Every fact is observed
 *
 * The display's name, its resolution and scale, how many surfaces are placed,
 * how many frames the compositor has presented, how many wake-ups the scheduler
 * has taken. All of it is read from the runtime that is running, and all of it
 * is available without a capability.
 *
 * ## What it deliberately does not show
 *
 * CPU load, memory, battery, network. Each needs `system.metrics` or a
 * capability that does not exist yet, and the gate that would enforce them is
 * M3. A first-party widget reaching for them anyway is the privileged path
 * `DD-008` forbids — and a widget that displayed a plausible number instead
 * would be worse than one that omits the row.
 */

import { widgetId } from '@devdesk/contracts';
import { everyMs, type WidgetContext, type WidgetUpdate } from '@devdesk/widget-engine';

import type { Feed, SystemSnapshot } from './feeds';
import {
  expectState,
  movesTime,
  type DesktopWidgetDefinition,
  type DesktopWidgetState,
} from './state';
import { envelope, type DesktopWidgetView } from './view';

/** A second: fast enough to look live, slow enough to cost nothing. */
export const SYSTEM_CADENCE_MS = 1_000;

export const SYSTEM_MANIFEST = Object.freeze({
  id: 'devdesk.system',
  name: 'System',
  version: '1.0.0',
  description: 'Display, surfaces, and pipeline counters for this session.',
  capabilities: [],
  preferredSize: { width: 300, height: 200 },
});

/** Builds the definition against a feed the controller owns. */
export function createSystemWidget(feed: Feed<SystemSnapshot>): DesktopWidgetDefinition {
  return Object.freeze({
    id: (() => {
      const parsed = widgetId(SYSTEM_MANIFEST.id);
      if (!parsed.ok) throw new Error('the system widget id must be valid');
      return parsed.value;
    })(),

    cadence: everyMs(SYSTEM_CADENCE_MS),

    initialize(_context: WidgetContext, at: number): DesktopWidgetState {
      return Object.freeze({ kind: 'system', facts: feed().facts, at });
    },

    update(raw: DesktopWidgetState, update: WidgetUpdate): DesktopWidgetState {
      const state = expectState(raw, 'system');
      if (!movesTime(update.reasons)) return state;

      const snapshot = feed();
      if (snapshot.facts === state.facts) return state;

      return Object.freeze({ kind: 'system', facts: snapshot.facts, at: update.at });
    },

    render(raw: DesktopWidgetState, context: WidgetContext): DesktopWidgetView {
      const state = expectState(raw, 'system');
      const headline = state.facts[0];

      return Object.freeze({
        ...envelope(context, {
          kind: 'system',
          title: 'System',
          // The first fact is the headline; the controller orders them so the
          // most useful one leads.
          time: headline ? headline.value : '—',
          date: headline ? headline.label : 'no display information',
        }),
        system: Object.freeze({ facts: state.facts }),
      });
    },
  });
}
