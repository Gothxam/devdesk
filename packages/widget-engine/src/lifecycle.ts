/**
 * How a widget instance progresses, and what it is allowed to do at each step.
 *
 * ```text
 *  registered ──create──▶ created ──attach──▶ attached ──start──▶ running
 *                            ▲                   │                 │  ▲
 *                            └─────detach────────┴─────────────────┘  │
 *                                                          suspend ───┘
 *                                                          resume  ◀──┐
 *                                                                     │
 *  every phase ──destroy──▶ destroyed  (terminal)             suspended
 * ```
 *
 * ## Deterministic by construction
 *
 * The transition table below is the whole machine. Given a phase and an event
 * there is exactly one answer, it never depends on anything outside those two
 * values, and there is no branch a reader has to hold in their head. That is
 * what makes it testable exhaustively — every phase × every event is 42 cases,
 * and the tests walk all of them.
 *
 * ## Why detach returns to `created`
 *
 * A widget can move between surfaces, and this is how: detach, then attach
 * somewhere else. It cannot go to `attached` on a different surface directly,
 * because there is a moment in between when it has no surface, and pretending
 * otherwise would let a caller believe a widget was on two surfaces at once.
 *
 * A running widget that detaches stops running, because running means "updating
 * into a surface" and there is now no surface to update into.
 *
 * ## Why `destroy` twice is an error
 *
 * Teardown is exactly where double-calls happen, so absorbing the second is
 * tempting. It is also how a caller loses track of what it owns. The window
 * subsystem made the same call for surface removal — the second one is a
 * caller's bug, and hiding it means the bug surfaces somewhere further away.
 * {@link WidgetLifecycle.isTerminal} is there for a caller that genuinely does
 * not know.
 */

import { err, ok, type Result } from '@devdesk/shared';

/** Where a widget instance is in its life. */
export type WidgetPhase =
  /** The manifest is known. Nothing has been built. */
  | 'registered'
  /** The instance exists and holds its context. It has no surface. */
  | 'created'
  /** It has a surface. It is not updating yet. */
  | 'attached'
  /** It is updating into its surface. */
  | 'running'
  /** It has a surface and is deliberately not updating. */
  | 'suspended'
  /** Gone. Terminal. */
  | 'destroyed';

/** Something that happens to a widget instance. */
export type WidgetLifecycleEvent =
  | 'create'
  | 'attach'
  | 'detach'
  | 'start'
  | 'suspend'
  | 'resume'
  | 'destroy';

/** Why a transition was refused. */
export interface LifecycleError {
  readonly kind: 'illegal-transition';
  readonly from: WidgetPhase;
  readonly event: WidgetLifecycleEvent;
}

/**
 * The whole machine.
 *
 * Every phase lists exactly the events it accepts. An event absent from a
 * phase's row is refused — there is no fallback, and adding one would be the
 * end of the determinism this table exists to provide.
 */
const TRANSITIONS: Readonly<
  Record<WidgetPhase, Partial<Readonly<Record<WidgetLifecycleEvent, WidgetPhase>>>>
> = Object.freeze({
  registered: { create: 'created', destroy: 'destroyed' },
  created: { attach: 'attached', destroy: 'destroyed' },
  attached: { start: 'running', detach: 'created', destroy: 'destroyed' },
  running: { suspend: 'suspended', detach: 'created', destroy: 'destroyed' },
  suspended: { resume: 'running', detach: 'created', destroy: 'destroyed' },
  // Terminal. Deliberately empty — including `destroy`, so a second teardown is
  // a reported bug rather than an absorbed one.
  destroyed: {},
});

/** Every phase, in the order they occur. */
export const WIDGET_PHASES: readonly WidgetPhase[] = Object.freeze([
  'registered',
  'created',
  'attached',
  'running',
  'suspended',
  'destroyed',
]);

/** Every event. */
export const WIDGET_LIFECYCLE_EVENTS: readonly WidgetLifecycleEvent[] = Object.freeze([
  'create',
  'attach',
  'detach',
  'start',
  'suspend',
  'resume',
  'destroy',
]);

/**
 * The phase an event leads to.
 *
 * Pure: same inputs, same answer, no state anywhere.
 */
export function nextPhase(
  from: WidgetPhase,
  event: WidgetLifecycleEvent,
): Result<WidgetPhase, LifecycleError> {
  const to = TRANSITIONS[from][event];
  if (to === undefined) return err({ kind: 'illegal-transition', from, event });
  return ok(to);
}

/** Whether an event is accepted from a phase. */
export function accepts(from: WidgetPhase, event: WidgetLifecycleEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/** Whether a widget in this phase has a surface. */
export function hasSurface(phase: WidgetPhase): boolean {
  return phase === 'attached' || phase === 'running' || phase === 'suspended';
}

/** Whether a widget in this phase is updating into its surface. */
export function isUpdating(phase: WidgetPhase): boolean {
  return phase === 'running';
}

/** One instance's position in the machine. */
export interface WidgetLifecycle {
  readonly phase: WidgetPhase;
  /** Whether nothing further can happen. */
  readonly isTerminal: boolean;
  readonly accepts: (event: WidgetLifecycleEvent) => boolean;
  /** Returns the lifecycle that results, leaving this one untouched. */
  readonly apply: (event: WidgetLifecycleEvent) => Result<WidgetLifecycle, LifecycleError>;
}

function at(phase: WidgetPhase): WidgetLifecycle {
  return Object.freeze({
    phase,
    isTerminal: phase === 'destroyed',
    accepts: (event: WidgetLifecycleEvent) => accepts(phase, event),
    apply(event: WidgetLifecycleEvent) {
      const next = nextPhase(phase, event);
      return next.ok ? ok(at(next.value)) : err(next.error);
    },
  });
}

/** A lifecycle that has only been registered. */
export function createLifecycle(): WidgetLifecycle {
  return at('registered');
}

/** A lifecycle resumed at a known phase, for tests and for state restoration. */
export function lifecycleAt(phase: WidgetPhase): WidgetLifecycle {
  return at(phase);
}

/** Renders a refusal as something a developer can act on. */
export function describeLifecycleError(error: LifecycleError): string {
  const allowed = Object.keys(TRANSITIONS[error.from]);
  return allowed.length === 0
    ? `a destroyed widget accepts no further events, but "${error.event}" was applied`
    : `"${error.event}" is not valid from "${error.from}" (accepts: ${allowed.join(', ')})`;
}
