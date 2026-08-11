/**
 * The session widget: how long this desktop has been up.
 *
 * The smallest honest system readout available without a capability. Uptime is
 * the runtime clock minus the moment this instance was initialised — no
 * platform call, no `system.metrics` grant, nothing to ask the user for
 * (`AC-FRE-6.1`).
 *
 * CPU and memory are deliberately absent: they need `system.metrics`, whose
 * gate is M3, and a first-party widget reading them anyway would be exactly the
 * privileged path `DD-008` forbids.
 */

import { widgetId } from '@devdesk/contracts';
import { everyMs, type WidgetContext, type WidgetUpdate } from '@devdesk/widget-engine';

import {
  expectState,
  hhmm,
  movesTime,
  type DesktopWidgetDefinition,
  type DesktopWidgetState,
} from './state';
import { envelope, type DesktopWidgetView } from './view';

export const SESSION_CADENCE_MS = 1_000;

export const SESSION_MANIFEST = Object.freeze({
  id: 'devdesk.session',
  name: 'Session',
  version: '1.0.0',
  description: 'How long this desktop has been running.',
  capabilities: [],
  preferredSize: { width: 300, height: 128 },
});

/**
 * Uptime as a person reads it.
 *
 * The largest non-zero unit, not all of them. `0h 0m 47s` is precise and
 * unreadable; `47s` is what someone glancing at a desktop wants.
 */
function formatUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export const SESSION_WIDGET: DesktopWidgetDefinition = Object.freeze({
  id: (() => {
    const parsed = widgetId(SESSION_MANIFEST.id);
    if (!parsed.ok) throw new Error('the session widget id must be valid');
    return parsed.value;
  })(),

  cadence: everyMs(SESSION_CADENCE_MS),

  initialize(_context: WidgetContext, at: number): DesktopWidgetState {
    return Object.freeze({ kind: 'session', startedAt: at, at });
  },

  update(raw: DesktopWidgetState, update: WidgetUpdate): DesktopWidgetState {
    const state = expectState(raw, 'session');
    if (!movesTime(update.reasons)) return state;

    // Whole seconds only. Ticking for a change the view cannot show would
    // re-render the widget for nothing.
    const before = Math.floor((state.at - state.startedAt) / 1000);
    const after = Math.floor((update.at - state.startedAt) / 1000);
    if (before === after) return state;

    return Object.freeze({ kind: 'session', startedAt: state.startedAt, at: update.at });
  },

  render(raw: DesktopWidgetState, context: WidgetContext): DesktopWidgetView {
    const state = expectState(raw, 'session');
    const elapsed = Math.max(0, state.at - state.startedAt);

    return Object.freeze({
      ...envelope(context, {
        kind: 'session',
        title: 'Session',
        time: formatUptime(elapsed),
        date: `since ${hhmm(state.startedAt)}`,
      }),
      session: Object.freeze({
        uptimeSeconds: Math.floor(elapsed / 1000),
        startedLabel: hhmm(state.startedAt),
      }),
    });
  },
});
