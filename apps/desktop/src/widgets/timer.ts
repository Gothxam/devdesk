/**
 * The real clock, supplied to the runtime.
 *
 * `@devdesk/widget-engine` declares a {@link TimerService} and deliberately
 * implements none: `setTimeout` belongs to a host environment and that package
 * has none, the same reason it declares a surface port rather than importing
 * Tauri. This is the shell satisfying it.
 *
 * `setTimeout` rather than `requestAnimationFrame`: the scheduler's job is
 * deciding *whether* work is due, which must keep happening when the window is
 * not being painted — a clock on a hidden surface still has to know a minute
 * turned. Frame-aligned rendering belongs to `@devdesk/animation`, which owns
 * RAF (§6.2.2).
 */

import type { CancelTimer, TimerService } from '@devdesk/widget-engine';

/** The system clock and system timer, as the runtime consumes them. */
export function createSystemTimer(): TimerService {
  return Object.freeze({
    // Wall-clock rather than performance.now(): widgets display this. A clock
    // needs to know it is 09:05, not that the process has been up for 4200 ms.
    now: () => Date.now(),

    schedule(afterMs: number, callback: () => void): CancelTimer {
      const handle = setTimeout(callback, Math.max(0, afterMs));
      return () => clearTimeout(handle);
    },
  });
}
