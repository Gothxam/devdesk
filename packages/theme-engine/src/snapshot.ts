/**
 * Immutable resolved theme state.
 *
 * A snapshot is the output of resolution and the *only* thing anything
 * downstream consumes. It is fully resolved — no references, no lazy lookups, no
 * deferred work. Reading a token is a map lookup that cannot fail.
 *
 * Immutability is what makes theme switching atomic. Switching is a snapshot
 * swap: there is no window in which half the desktop reads the old theme and
 * half reads the new one, because the old snapshot is never mutated
 * (`AC-THM-3.1`).
 */

import type { ThemeMode, TokenId } from './token';

/**
 * The snapshot format version.
 *
 * Snapshots outlive the process that made them: they are cached, and they will
 * eventually be persisted so a theme does not have to re-resolve at every cold
 * start. A version stamped at creation is what makes that migration a decision
 * rather than an archaeology exercise — a reader can tell what it is holding
 * before it tries to interpret it.
 *
 * Bump on any change to the snapshot's shape or to the meaning of a field.
 */
export const THEME_SNAPSHOT_VERSION = 1;

/** Where a resolved value came from. Diagnostic only; never affects rendering. */
export type ValueOrigin = 'theme' | 'fallback' | 'accessibility-override' | 'embedded';

/** Descriptive facts about a snapshot. Deterministic: no clock, no counters. */
export interface ThemeSnapshotMetadata {
  readonly themeId: string;
  readonly themeName: string;
  readonly mode: ThemeMode;
  readonly tokenCount: number;
  readonly overrideCount: number;
}

/**
 * A fully resolved, frozen theme.
 *
 * Compared by identity first and by {@link ThemeSnapshot.hash} otherwise, so two
 * snapshots produced from identical inputs in different pools still diff to
 * nothing.
 */
export interface ThemeSnapshot {
  readonly version: number;
  /** Content hash of the inputs that produced this snapshot. */
  readonly hash: string;
  /** Every token, resolved to a concrete value. Total by construction (TH-3). */
  readonly tokens: ReadonlyMap<TokenId, string>;
  /** Provenance per token, for the diagnostics that make `AC-THM-6.2` possible. */
  readonly origins: ReadonlyMap<TokenId, ValueOrigin>;
  /** Tokens an accessibility preference overrode. No theme can remove an entry. */
  readonly accessibilityOverrides: ReadonlySet<TokenId>;
  readonly metadata: ThemeSnapshotMetadata;
}

/** Reads a token. Cannot fail: resolution is total (TH-3). */
export function readToken(snapshot: ThemeSnapshot, id: TokenId): string | undefined {
  return snapshot.tokens.get(id);
}

/**
 * Freezes a snapshot so downstream code cannot mutate shared theme state.
 *
 * `B-2` puts authority over shared state in one place. A consumer that could
 * mutate a snapshot would become a second authority over appearance, and the
 * resulting divergence reproduces only under specific timing.
 */
export function freezeSnapshot(snapshot: ThemeSnapshot): ThemeSnapshot {
  return Object.freeze({ ...snapshot, metadata: Object.freeze(snapshot.metadata) });
}
