/**
 * How a widget reads runtime facts it cannot compute for itself.
 *
 * ## The problem
 *
 * A widget's three functions receive a state, an update, and a context. That is
 * enough for a clock, whose entire input is a timestamp. It is not enough for a
 * widget whose subject is the runtime itself — how many frames the compositor
 * presented, what the display is called, what the scheduler did.
 *
 * ## The shape, and why it is not a hole in the purity rule
 *
 * A feed is a reader of an **immutable snapshot** the controller swaps
 * atomically. The widget reads it during `update` and folds what it finds into
 * its state; `render` stays a pure function of state and context.
 *
 * That is exactly what `ThemeSnapshot` already is: external immutable state a
 * widget reads and does not own. The difference is only the delivery route —
 * the theme arrives on the context because every widget wants it, and these
 * arrive through a closure because two widgets do. Determinism holds the same
 * way it does for the theme: given the snapshot, the output is fixed.
 *
 * When the kernel's event bus lands, these become context-delivered like the
 * theme, and the closure disappears. The shape is deliberately close to that
 * destination so the move is a change of plumbing rather than of contract.
 *
 * ## What a feed must never do
 *
 * Return a mutable object, or a different value twice within one update pass.
 * The controller builds a frozen value and swaps the reference; a feed that
 * computed on demand would let two widgets in the same pass disagree about what
 * the runtime is doing.
 */

import type { ActivityEntry, SystemFact } from './view';

/** What the activity log reads. */
export interface ActivitySnapshot {
  /** Newest first, already bounded by the controller. */
  readonly entries: readonly ActivityEntry[];
  /** Every event this session has produced, including ones dropped from the tail. */
  readonly total: number;
}

/** What the system readout reads. */
export interface SystemSnapshot {
  readonly facts: readonly SystemFact[];
}

/** An immutable snapshot, read on demand. */
export type Feed<T> = () => T;

/** An empty activity snapshot. What a session that has done nothing reports. */
export const EMPTY_ACTIVITY: ActivitySnapshot = Object.freeze({
  entries: Object.freeze([]),
  total: 0,
});

/** An empty system snapshot. */
export const EMPTY_SYSTEM: SystemSnapshot = Object.freeze({ facts: Object.freeze([]) });
