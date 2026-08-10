/**
 * Time, as the runtime consumes it.
 *
 * Every clock read and every scheduled wake-up in this package goes through a
 * {@link TimerService}. Nothing calls `Date.now()` or `setTimeout` directly.
 *
 * That is worth the indirection twice over:
 *
 * - **Tests are deterministic.** {@link createManualTimer} advances time by an
 *   exact amount and fires exactly the callbacks that became due. A scheduler
 *   test asserts what happened after 3.5 seconds without taking 3.5 seconds, and
 *   without the flake that fake-timer patching brings.
 * - **The clock is one thing.** Two widgets updated in the same pass are handed
 *   the same `at`, because the scheduler read it once. Left to themselves they
 *   would each read a slightly different now, and a desktop full of clocks would
 *   show two different minutes for a moment.
 */

/** Stops a scheduled callback. Safe to call more than once, and after firing. */
export type CancelTimer = () => void;

/** What the runtime needs from a clock. */
export interface TimerService {
  /**
   * The current time in milliseconds.
   *
   * Wall-clock rather than monotonic, because widgets display it — a clock
   * needs to know it is 09:05, not that the process has been up for 4200 ms.
   * The scheduler only ever takes differences, so a clock adjustment costs at
   * most one early or late update.
   */
  readonly now: () => number;

  /**
   * Runs `callback` no sooner than `afterMs` from now.
   *
   * "No sooner" rather than "at": every timer implementation is allowed to be
   * late, and the scheduler is written to expect it.
   */
  readonly schedule: (afterMs: number, callback: () => void) => CancelTimer;
}

/**
 * There is deliberately no real timer in this package.
 *
 * `setTimeout` belongs to a host environment, and this package has none — the
 * same reason {@link import('./surface').SurfacePort} exists rather than a Tauri
 * import. The shell supplies the real clock; what lives here is the interface it
 * must satisfy and the manual one tests drive.
 *
 * That is not a workaround. A runtime that could reach a global timer could also
 * be *given* one by a widget, and the whole point of Stage 3.5 is that periodic
 * execution has exactly one owner.
 */

/** A timer a test drives by hand. */
export interface ManualTimer extends TimerService {
  /**
   * Moves time forward, firing everything that becomes due.
   *
   * Callbacks fire in due order, and a callback that schedules another for a
   * time still inside this advance is fired too — so one `advance(5_000)` is
   * indistinguishable from five `advance(1_000)` calls, which is what makes a
   * test of a repeating cadence trustworthy.
   */
  readonly advance: (byMs: number) => void;
  /** How many callbacks are waiting. Zero on an idle desktop. */
  readonly pending: () => number;
}

interface ScheduledCallback {
  readonly at: number;
  readonly sequence: number;
  readonly callback: () => void;
  cancelled: boolean;
}

/**
 * A clock a test controls completely.
 *
 * Starts at an arbitrary but fixed instant rather than zero: a scheduler bug
 * that only appears when timestamps are large — an overflow, a truncation, a
 * comparison against a falsy zero — would hide behind a clock that starts at 0.
 */
export function createManualTimer(startAt = 1_700_000_000_000): ManualTimer {
  let current = startAt;
  let sequence = 0;
  let scheduled: ScheduledCallback[] = [];

  return Object.freeze({
    now: () => current,

    schedule(afterMs: number, callback: () => void): CancelTimer {
      sequence += 1;
      const entry: ScheduledCallback = {
        at: current + Math.max(0, afterMs),
        sequence,
        callback,
        cancelled: false,
      };
      scheduled = [...scheduled, entry];

      return () => {
        entry.cancelled = true;
        scheduled = scheduled.filter((candidate) => candidate !== entry);
      };
    },

    advance(byMs: number) {
      const target = current + Math.max(0, byMs);

      // Loop rather than sweep once: a callback may schedule another that is
      // also due before `target`, and a repeating cadence is exactly that.
      for (;;) {
        const due = scheduled
          .filter((entry) => !entry.cancelled && entry.at <= target)
          // Ties break by insertion order, so two callbacks due at the same
          // instant run in the order they were scheduled rather than in
          // whatever order the array happens to hold.
          .sort((a, b) => a.at - b.at || a.sequence - b.sequence);

        const next = due[0];
        if (!next) break;

        scheduled = scheduled.filter((entry) => entry !== next);
        // Time is set to the callback's due moment, not to `target`: a callback
        // that reads `now()` must see when it was *due*, or a cadence would
        // drift forward by the size of the advance.
        current = Math.max(current, next.at);
        next.callback();
      }

      current = target;
    },

    pending: () => scheduled.filter((entry) => !entry.cancelled).length,
  });
}
