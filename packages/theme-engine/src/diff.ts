/**
 * The diff stage.
 *
 * ```text
 * ThemeSource → ThemeSnapshot → ThemeDiff → CustomPropertyPatch → DOM
 * ```
 *
 * A diff is **token-domain**: it says which tokens changed, not which CSS
 * properties. Emission turns it into a patch for one target (`emit.ts`), so a
 * second target — a native surface backend (§26.1) — consumes the same diff.
 *
 * ## Why the DOM is never updated from a snapshot directly
 *
 * There is deliberately no function that takes a snapshot and touches a
 * document. Applying a whole snapshot means writing every property on every
 * surface on every change; applying a diff means writing the handful that moved.
 * At the reference workload — 12 surfaces, and far more later — that is the
 * difference between a theme switch inside `PB-R4` and one that scales with the
 * size of the token set rather than the size of the change.
 *
 * Even first paint goes through a diff (against `undefined`), so there is one
 * code path rather than a fast one and a slow one that drift apart.
 */

import type { ThemeSnapshot } from './snapshot';
import type { TokenId } from './token';

/** What changed between two snapshots, in token terms. */
export interface ThemeDiff {
  readonly fromThemeId: string | undefined;
  readonly toThemeId: string;
  /** Tokens whose value changed, or which are new. */
  readonly changed: ReadonlyMap<TokenId, string>;
  /** Tokens present before and absent now. Removed, not blanked. */
  readonly removed: ReadonlySet<TokenId>;
}

/** Whether applying this diff would do nothing. */
export function isEmptyDiff(diff: ThemeDiff): boolean {
  return diff.changed.size === 0 && diff.removed.size === 0;
}

/**
 * Computes the token-level difference between two snapshots.
 *
 * Interned snapshots make the common case free: when `from` and `to` are the
 * same object the result is empty without comparing anything, which is what
 * makes repeated preview of the same theme cost nothing (`AC-THM-2.3`).
 */
export function diffSnapshots(from: ThemeSnapshot | undefined, to: ThemeSnapshot): ThemeDiff {
  const changed = new Map<TokenId, string>();
  const removed = new Set<TokenId>();

  if (from === to) {
    return Object.freeze({
      fromThemeId: from?.themeId,
      toThemeId: to.themeId,
      changed,
      removed,
    });
  }

  for (const [id, value] of to.tokens) {
    if (from === undefined || from.tokens.get(id) !== value) {
      changed.set(id, value);
    }
  }

  if (from !== undefined) {
    for (const id of from.tokens.keys()) {
      if (!to.tokens.has(id)) removed.add(id);
    }
  }

  return Object.freeze({
    fromThemeId: from?.themeId,
    toThemeId: to.themeId,
    changed,
    removed,
  });
}
