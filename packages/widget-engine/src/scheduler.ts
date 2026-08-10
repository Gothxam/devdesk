/**
 * When widgets run.
 *
 * The host knows *what* is owed; this decides *when* it happens. Splitting it
 * that way is what makes everything below possible — a host that ran each cause
 * as it arrived would have nothing left to coalesce, throttle, or decline.
 *
 * ## One timer for the whole desktop
 *
 * Not one per widget. The scheduler computes the earliest moment anything is
 * due, sets a single wake-up for it, and on waking flushes everything that has
 * become due and schedules the next one.
 *
 * With N widgets that is one timer instead of N, which matters directly for
 * `B-4`: forty widgets each holding a `setInterval` is forty wake-ups a second
 * on a desktop nobody is touching, and the cost is invisible because no single
 * one of them looks expensive.
 *
 * ## Coalescing
 *
 * Causes accumulate on the host between flushes. A theme change, a display
 * change, and an elapsed interval landing in the same window become **one**
 * `update` call carrying all three reasons. The widget decides what to recompute
 * from them; the scheduler's contribution is that it only asked once.
 *
 * ## Throttling
 *
 * No instance is flushed more often than {@link SchedulerOptions.minIntervalMs}.
 * A widget that asks for an update every millisecond, or a burst of topology
 * events, cannot turn into a burst of work — the requests coalesce into the next
 * permitted flush instead. The default is one frame at 60 Hz, because more often
 * than the screen refreshes is work nobody can see.
 *
 * ## Idle means idle
 *
 * With nothing dirty and no widget declaring a cadence, the scheduler holds no
 * timer at all. It is not polling and waking to find nothing to do; it has
 * genuinely stopped.
 */

import type { WidgetInstanceId } from '@devdesk/contracts';

import { type UpdateCadence, type WidgetUpdateReason } from './definition';
import { isUpdating, type WidgetPhase } from './lifecycle';
import type { WidgetHost, InstanceSnapshot } from './host';
import type { CancelTimer, TimerService } from './timer';

/** How the scheduler behaves. */
export interface SchedulerOptions {
  /**
   * The shortest gap between two flushes of one instance.
   *
   * Defaults to 16 ms — one frame at 60 Hz. Updating more often than the screen
   * refreshes is work nobody can see, and a widget that asks for it gets its
   * requests coalesced into the next permitted flush rather than honoured.
   */
  readonly minIntervalMs?: number;
}

/** What one flush pass did. */
export interface FlushReport {
  /** The moment the pass ran. One value for every widget in it. */
  readonly at: number;
  /** Instances whose state changed and which therefore need re-rendering. */
  readonly changed: readonly WidgetInstanceId[];
  /** Instances that ran but reported no change. */
  readonly unchanged: readonly WidgetInstanceId[];
  /** Instances that owed work but were not permitted to run yet. */
  readonly throttled: readonly WidgetInstanceId[];
  /** Instances that owed work but are not running. */
  readonly skipped: readonly WidgetInstanceId[];
}

/** Counters, for the benchmark and for a diagnostic. */
export interface SchedulerMetrics {
  /** Passes that ran, whether or not anything was due. */
  readonly passes: number;
  /** Widget `update` calls made. */
  readonly updates: number;
  /** Causes folded into those calls. Above `updates` means coalescing worked. */
  readonly reasons: number;
  /** Flushes deferred because the instance had run too recently. */
  readonly throttled: number;
  /** Flushes declined because the instance was not running. */
  readonly skipped: number;
  /** Timers set. One per wake-up, not one per widget. */
  readonly wakeups: number;
}

/** One instance's schedule. */
interface Entry {
  readonly instanceId: WidgetInstanceId;
  cadence: UpdateCadence;
  /** When its cadence next comes round. `Infinity` when it has none. */
  nextIntervalAt: number;
  /** When it last ran, for throttling. */
  lastFlushAt: number;
}

const DEFAULT_MIN_INTERVAL_MS = 16;

/**
 * Drives widget updates.
 *
 * Holds the host and the timer and owns nothing else. It never renders — it
 * reports which instances changed, and the shell decides what to do about that.
 */
export class WidgetScheduler<TState, TView> {
  readonly #host: WidgetHost<TState, TView>;
  readonly #timer: TimerService;
  readonly #minIntervalMs: number;
  readonly #entries = new Map<WidgetInstanceId, Entry>();

  #cancel: CancelTimer | undefined;
  #wakeAt: number | undefined;
  #running = false;
  #metrics: SchedulerMetrics = {
    passes: 0,
    updates: 0,
    reasons: 0,
    throttled: 0,
    skipped: 0,
    wakeups: 0,
  };

  constructor(
    host: WidgetHost<TState, TView>,
    timer: TimerService,
    options: SchedulerOptions = {},
  ) {
    this.#host = host;
    this.#timer = timer;
    this.#minIntervalMs = Math.max(0, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  }

  get metrics(): SchedulerMetrics {
    return Object.freeze({ ...this.#metrics });
  }

  /** How many instances are being scheduled. */
  get size(): number {
    return this.#entries.size;
  }

  /** Whether a wake-up is currently set. False on a genuinely idle desktop. */
  get isArmed(): boolean {
    return this.#cancel !== undefined;
  }

  /** Begins running. Nothing is flushed until something is due. */
  start(): void {
    this.#running = true;
    this.rearm();
  }

  /**
   * Stops running and drops the wake-up.
   *
   * Does not flush what is owed. A stopped scheduler is a paused desktop, not a
   * discarded one: causes stay on the host and are delivered when it starts
   * again, coalesced into one update rather than replayed one at a time.
   */
  stop(): void {
    this.#running = false;
    this.disarm();
  }

  /**
   * Schedules an instance.
   *
   * The cadence is read from the host's snapshot rather than passed in, so the
   * scheduler and the definition cannot disagree about how often a widget wants
   * to run.
   */
  register(instanceId: WidgetInstanceId): boolean {
    const snapshot = this.#host.snapshot(instanceId);
    if (!snapshot) return false;

    const now = this.#timer.now();
    this.#entries.set(instanceId, {
      instanceId,
      cadence: snapshot.cadence,
      nextIntervalAt: dueAfter(snapshot.cadence, now),
      // Far enough back that the instance's first flush is never throttled: it
      // has never run, and making a widget wait a frame to appear is the flash
      // problem in a different costume.
      lastFlushAt: Number.NEGATIVE_INFINITY,
    });

    this.rearm();
    return true;
  }

  /** Stops scheduling an instance. */
  unregister(instanceId: WidgetInstanceId): boolean {
    const removed = this.#entries.delete(instanceId);
    if (removed) this.rearm();
    return removed;
  }

  /** Whether an instance is being scheduled. */
  has(instanceId: WidgetInstanceId): boolean {
    return this.#entries.has(instanceId);
  }

  /**
   * Records a cause and makes sure a flush is coming.
   *
   * The work is not done here. Recording and running are separate so that ten
   * causes arriving in one millisecond produce one update, not ten.
   */
  request(instanceId: WidgetInstanceId, reason: WidgetUpdateReason): void {
    this.#host.markDirty(instanceId, reason);
    this.rearm();
  }

  /**
   * Suspends an instance and stops scheduling it.
   *
   * Goes through the scheduler rather than straight to the host because the
   * scheduler cannot observe a phase change: it holds one wake-up computed from
   * what is currently runnable, and a phase that moved underneath it would leave
   * that wake-up wrong. Suspending directly on the host is not an error — the
   * scheduler discovers it on the next pass and declines to run the widget — but
   * resuming that way would leave it asleep, because nothing would re-arm.
   */
  suspend(instanceId: WidgetInstanceId): boolean {
    const suspended = this.#host.suspend(instanceId).ok;
    if (suspended) this.rearm();
    return suspended;
  }

  /**
   * Resumes an instance and schedules it again.
   *
   * The host marks it dirty with `resumed`, because time passed while it was
   * not updating. Its cadence resumes from now rather than replaying every
   * interval that elapsed while it was away.
   */
  resume(instanceId: WidgetInstanceId): boolean {
    const resumed = this.#host.resume(instanceId).ok;
    if (!resumed) return false;

    const entry = this.#entries.get(instanceId);
    if (entry) entry.nextIntervalAt = dueAfter(entry.cadence, this.#timer.now());

    this.rearm();
    return true;
  }

  /** Records one cause against many instances — a theme change, typically. */
  requestAll(instanceIds: Iterable<WidgetInstanceId>, reason: WidgetUpdateReason): void {
    for (const instanceId of instanceIds) this.#host.markDirty(instanceId, reason);
    this.rearm();
  }

  /**
   * Runs every instance that is due, now.
   *
   * The clock is read **once** for the whole pass, so two widgets updated
   * together are handed the same `at`. Reading it per widget would let a desktop
   * full of clocks show two different minutes for a moment.
   */
  flushDue(): FlushReport {
    const at = this.#timer.now();
    const changed: WidgetInstanceId[] = [];
    const unchanged: WidgetInstanceId[] = [];
    const throttled: WidgetInstanceId[] = [];
    const skipped: WidgetInstanceId[] = [];

    this.#metrics = { ...this.#metrics, passes: this.#metrics.passes + 1 };

    // Sorted so a pass is deterministic: the same set of due instances is always
    // flushed in the same order, whatever order they were registered in.
    for (const instanceId of [...this.#entries.keys()].sort()) {
      const entry = this.#entries.get(instanceId);
      if (!entry) continue;

      const snapshot = this.#host.snapshot(instanceId);
      if (!snapshot) {
        // The instance went away without being unregistered. Tidy up rather
        // than carry a schedule for something that no longer exists.
        this.#entries.delete(instanceId);
        continue;
      }

      const intervalDue = at >= entry.nextIntervalAt;
      if (intervalDue && canRun(snapshot.phase)) {
        this.#host.markDirty(instanceId, 'interval');
        entry.nextIntervalAt = dueAfter(entry.cadence, at);
      } else if (intervalDue) {
        // Not running: the cadence still moves on, so resuming does not
        // immediately fire every interval that elapsed while it was suspended.
        entry.nextIntervalAt = dueAfter(entry.cadence, at);
      }

      if (!this.#host.isDirty(instanceId)) continue;

      if (!canRun(snapshot.phase)) {
        skipped.push(instanceId);
        this.#metrics = { ...this.#metrics, skipped: this.#metrics.skipped + 1 };
        continue;
      }

      if (at - entry.lastFlushAt < this.#minIntervalMs) {
        throttled.push(instanceId);
        this.#metrics = { ...this.#metrics, throttled: this.#metrics.throttled + 1 };
        continue;
      }

      const outcome = this.#host.flush(instanceId, at);
      if (!outcome.ok) continue;

      entry.lastFlushAt = at;
      this.#metrics = {
        ...this.#metrics,
        updates: this.#metrics.updates + 1,
        reasons: this.#metrics.reasons + outcome.value.reasons.length,
      };

      if (outcome.value.changed) changed.push(instanceId);
      else unchanged.push(instanceId);
    }

    this.rearm();

    return Object.freeze({
      at,
      changed: Object.freeze(changed),
      unchanged: Object.freeze(unchanged),
      throttled: Object.freeze(throttled),
      skipped: Object.freeze(skipped),
    });
  }

  /** When the scheduler will next wake, or `undefined` if it is idle. */
  nextWakeAt(): number | undefined {
    return this.#wakeAt;
  }

  // --------------------------------------------------------------- internal --

  /**
   * Sets, moves, or drops the single wake-up.
   *
   * Re-armed after anything that could change what is due. Cancelling and
   * re-scheduling is cheap and keeps the invariant simple: there is at most one
   * timer, and it is always set for the earliest thing that is due.
   */
  private rearm(): void {
    if (!this.#running) return;

    const now = this.#timer.now();
    const due = this.earliestDue(now);

    if (due === undefined) {
      // Genuinely nothing to do. Hold no timer at all rather than poll.
      this.disarm();
      return;
    }

    if (this.#wakeAt !== undefined && this.#wakeAt <= due) return;

    this.disarm();
    this.#wakeAt = due;
    this.#metrics = { ...this.#metrics, wakeups: this.#metrics.wakeups + 1 };
    this.#cancel = this.#timer.schedule(Math.max(0, due - now), () => {
      this.#cancel = undefined;
      this.#wakeAt = undefined;
      this.flushDue();
    });
  }

  private disarm(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    this.#wakeAt = undefined;
  }

  /** The earliest moment anything needs attention. */
  private earliestDue(now: number): number | undefined {
    let earliest: number | undefined;

    for (const entry of this.#entries.values()) {
      const snapshot = this.#host.snapshot(entry.instanceId);
      if (!snapshot || !canRun(snapshot.phase)) continue;

      const candidates: number[] = [entry.nextIntervalAt];
      if (this.#host.isDirty(entry.instanceId)) {
        // Dirty now, but no sooner than throttling permits.
        candidates.push(Math.max(now, entry.lastFlushAt + this.#minIntervalMs));
      }

      for (const candidate of candidates) {
        if (Number.isFinite(candidate) && (earliest === undefined || candidate < earliest)) {
          earliest = candidate;
        }
      }
    }

    return earliest;
  }
}

/** Whether a widget in this phase may be updated. */
function canRun(phase: WidgetPhase): boolean {
  return isUpdating(phase);
}

/** When a cadence next comes round after `from`. */
function dueAfter(cadence: UpdateCadence, from: number): number {
  return cadence.kind === 'interval' ? from + cadence.everyMs : Number.POSITIVE_INFINITY;
}

/** Reads the cadence off a snapshot without holding the definition. */
export function cadenceOf(snapshot: InstanceSnapshot): UpdateCadence {
  return snapshot.cadence;
}
