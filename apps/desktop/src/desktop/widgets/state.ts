/**
 * Every first-party widget's state, as one type.
 *
 * `WidgetHost` is generic over a single state type, because a host whose
 * widgets had unrelated types could not hold them in one map. Five kinds of
 * widget therefore share one union, and each narrows by its `kind`.
 *
 * That is the smallest thing that works. The alternative — a host per widget
 * type, or an existential wrapper — is machinery, and this desktop needs
 * widgets rather than machinery. When third-party widgets arrive in M3 the
 * union stops being expressible and the host grows a real boundary; until then
 * a discriminated union is honest about there being exactly five.
 */

import type { WidgetDefinition } from '@devdesk/widget-engine';

import type { ActivityEntry, DesktopWidgetView, SystemFact } from './view';

/** The clock: the moment it is showing. */
export interface ClockState {
  readonly kind: 'clock';
  readonly at: number;
}

/** The calendar: local midnight of the day it is showing. */
export interface CalendarState {
  readonly kind: 'calendar';
  readonly dayStart: number;
}

/** The session: when it started, and when it last looked. */
export interface SessionState {
  readonly kind: 'session';
  readonly startedAt: number;
  readonly at: number;
}

/** The activity log: the entries it has been given, newest first. */
export interface ActivityState {
  readonly kind: 'activity';
  readonly entries: readonly ActivityEntry[];
  readonly total: number;
  readonly at: number;
}

/** The system readout: the facts it has been given. */
export interface SystemState {
  readonly kind: 'system';
  readonly facts: readonly SystemFact[];
  readonly at: number;
}

/** Any first-party widget's state. */
export type DesktopWidgetState =
  | ClockState
  | CalendarState
  | SessionState
  | ActivityState
  | SystemState;

/** Every first-party widget shares one state and one view type. */
export type DesktopWidgetDefinition = WidgetDefinition<DesktopWidgetState, DesktopWidgetView>;

/**
 * Narrows a state, or throws.
 *
 * A widget receiving another widget's state is a host bug, not a runtime
 * condition — the host hands each instance back the state it produced.
 * Throwing says so; returning a default would paper over it and render
 * something plausible but wrong.
 */
export function expectState<K extends DesktopWidgetState['kind']>(
  state: DesktopWidgetState,
  kind: K,
): Extract<DesktopWidgetState, { kind: K }> {
  if (state.kind !== kind) {
    throw new Error(`widget state mismatch: expected ${kind}, received ${state.kind}`);
  }
  return state as Extract<DesktopWidgetState, { kind: K }>;
}

/** Two digits, for a clock face. */
export function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `HH:MM` from an epoch millisecond. */
export function hhmm(at: number): string {
  const date = new Date(at);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * Whether an update is one that moves a widget's clock forward.
 *
 * A theme change does not change what a clock reads, and recomputing for it
 * would make a cheap widget expensive on a path that has nothing to do with it.
 */
export function movesTime(reasons: readonly string[]): boolean {
  return reasons.includes('interval') || reasons.includes('resumed') || reasons.includes('requested');
}
