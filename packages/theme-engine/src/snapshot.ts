/**
 * Immutable resolved theme state.
 *
 * A snapshot is the output of resolution and the *only* thing anything downstream
 * consumes. It is fully resolved — no references, no lazy lookups, no deferred
 * work. Reading a token is a map lookup that cannot fail.
 *
 * Immutability is what makes theme switching atomic. Switching is a snapshot
 * swap: there is no window in which half the desktop reads the old theme and half
 * reads the new one, because the old snapshot is never mutated (`AC-THM-3.1`).
 */

import type { ThemeMode, TokenId } from './token';

/** Where a resolved value came from. Diagnostic only; never affects rendering. */
export type ValueOrigin = 'theme' | 'fallback' | 'accessibility-override';

/**
 * A fully resolved, frozen theme.
 *
 * Snapshots are compared by identity. Two snapshots produced from the same source
 * and context are distinct objects, so a consumer holding one is unaffected by a
 * later resolution — which is the property that makes `AC-THM-2.3` (a preview is
 * non-destructive) achievable without a rollback path.
 */
export interface ThemeSnapshot {
  readonly themeId: string;
  readonly themeName: string;
  readonly mode: ThemeMode;
  /** Every token, resolved to a concrete value. Total by construction (TH-3). */
  readonly tokens: ReadonlyMap<TokenId, string>;
  /** Provenance per token, for the diagnostics that make `AC-THM-6.2` possible. */
  readonly origins: ReadonlyMap<TokenId, ValueOrigin>;
  /**
   * Tokens an accessibility preference overrode.
   *
   * Surfaced so the user can be told which values the operating system is
   * controlling and why (`AC-THM-6.2`). No theme can remove an entry here.
   */
  readonly accessibilityOverrides: ReadonlySet<TokenId>;
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
  return Object.freeze({
    ...snapshot,
    tokens: snapshot.tokens,
    origins: snapshot.origins,
    accessibilityOverrides: snapshot.accessibilityOverrides,
  });
}
