/**
 * Whether a widget is worth running.
 *
 * ## Three states, not two
 *
 * The obvious model is visible/hidden. It has a deadlock in it.
 *
 * A surface is created hidden and revealed only once its content has painted
 * (`AC-FRE-1.1`). A policy that suspends hidden widgets would therefore suspend
 * every widget the moment it was placed — so it would never update, so it would
 * never paint, so it would never be revealed, so it would never stop being
 * hidden. The desktop would come up empty and nothing would look broken.
 *
 * `pending` is the state that breaks it: created, not yet on screen, and
 * **entitled to run** precisely because it has work to do before it can appear.
 *
 * | State | Means | Runs? |
 * | --- | --- | --- |
 * | `pending` | Placed, not yet revealed | **Yes** — it has to paint to be revealed |
 * | `visible` | On screen | Yes |
 * | `hidden` | Was on screen, is not now | No |
 *
 * ## The policy is a pure function
 *
 * It takes what is known and returns a decision. No clock, no state, no side
 * effects — so "would this widget be suspended in this situation" is answerable
 * by calling it, and the table of situations is a test rather than a claim.
 */

import type { WidgetPhase } from './lifecycle';

/** Whether a widget's surface is on screen. */
export type WidgetVisibility =
  /** Placed and hidden, waiting to paint its first frame. Runs. */
  | 'pending'
  /** On screen. */
  | 'visible'
  /** Was on screen and is not now. */
  | 'hidden';

/** Every visibility state. */
export const WIDGET_VISIBILITIES: readonly WidgetVisibility[] = Object.freeze([
  'pending',
  'visible',
  'hidden',
]);

/** What a suspend decision is made from. */
export interface SuspendSignals {
  readonly visibility: WidgetVisibility;
  /**
   * Whether the surface has a display.
   *
   * `false` on a closed lid with nothing plugged in. Running a widget then is
   * computing something that cannot be looked at.
   */
  readonly hasDisplay: boolean;
  /** Where the widget is in its lifecycle. */
  readonly phase: WidgetPhase;
}

/** Decides whether a widget should be running. */
export interface SuspendPolicy {
  readonly name: string;
  /** Pure. Same signals, same answer, always. */
  readonly shouldSuspend: (signals: SuspendSignals) => boolean;
}

/**
 * Suspend a widget that nobody can see.
 *
 * Two reasons, and neither is negotiable at the widget's discretion:
 *
 * - **Hidden.** Its output is not on screen, so computing it spends the idle
 *   budget (`B-4`) on something nobody will look at.
 * - **No display.** There is no screen at all. Same argument, stronger.
 *
 * `pending` is deliberately not suspended — see the module note. A widget that
 * has never painted must run, or it can never be revealed.
 */
export const SUSPEND_WHEN_UNSEEN: SuspendPolicy = Object.freeze({
  name: 'suspend-when-unseen',
  shouldSuspend(signals: SuspendSignals): boolean {
    if (signals.visibility === 'pending') return false;
    return signals.visibility === 'hidden' || !signals.hasDisplay;
  },
});

/**
 * Never suspend.
 *
 * For a caller driving suspension itself, and for tests that want the scheduler
 * to stop deciding. Not a default: a desktop that never suspends anything is how
 * an idle machine ends up with a warm fan.
 */
export const NEVER_SUSPEND: SuspendPolicy = Object.freeze({
  name: 'never-suspend',
  shouldSuspend: () => false,
});

/** What {@link SUSPEND_WHEN_UNSEEN} decides, in one word, for a diagnostic. */
export function describeSuspendDecision(signals: SuspendSignals, policy: SuspendPolicy): string {
  const suspend = policy.shouldSuspend(signals);
  const because =
    signals.visibility === 'pending'
      ? 'it has not painted yet'
      : signals.visibility === 'hidden'
        ? 'it is not on screen'
        : !signals.hasDisplay
          ? 'no display is attached'
          : 'it is on screen';

  return `${suspend ? 'suspend' : 'run'}: ${because}`;
}
