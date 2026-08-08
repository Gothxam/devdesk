/**
 * Emission: turning a {@link ThemeDiff} into CSS custom properties.
 *
 * ```text
 * ThemeSnapshot → ThemeDiff → CustomPropertyPatch → DOM
 * ```
 *
 * Emission consumes a **diff**, never a snapshot. There is deliberately no
 * snapshot-to-DOM path: see `diff.ts` for why, and note that the absence of the
 * function is the enforcement. A second emission target for a native surface
 * backend (§26.1) is a new function here, not a change to the engine.
 *
 * Custom properties are the target because TH-4 requires switching to re-emit
 * properties on the root rather than remount the tree — which is what makes
 * `PB-R4` reachable at all.
 */

import type { ThemeDiff } from './diff';
import type { TokenId } from './token';

/** Characters permitted in a token id. */
const VALID_TOKEN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * A patch to apply to a document root.
 *
 * Removal is explicit rather than "set to empty string": a stale property left
 * behind is a value the user did not choose, still rendering.
 */
export interface CustomPropertyPatch {
  readonly set: Readonly<Record<string, string>>;
  readonly remove: readonly string[];
}

/** Converts a token id to a CSS custom property name. */
export function customPropertyName(id: TokenId): string {
  return `--${id.replaceAll('.', '-')}`;
}

/** Whether a token id can be emitted as a custom property. */
export function isEmittableTokenId(id: string): boolean {
  return VALID_TOKEN_ID.test(id);
}

/**
 * Renders a diff as a custom-property patch.
 *
 * Tokens whose ids cannot be expressed as a property name are omitted rather
 * than emitted malformed — a malformed property is silently ignored by the
 * browser, which is exactly the silent failure P-9 prohibits. Use
 * {@link findUnemittableTokenIds} to surface them at validation time instead.
 */
export function emitDiff(diff: ThemeDiff): CustomPropertyPatch {
  const set: Record<string, string> = {};
  const remove: string[] = [];

  for (const [id, value] of diff.changed) {
    if (!isEmittableTokenId(id)) continue;
    set[customPropertyName(id)] = value;
  }

  for (const id of diff.removed) {
    if (!isEmittableTokenId(id)) continue;
    remove.push(customPropertyName(id));
  }

  return Object.freeze({ set: Object.freeze(set), remove: Object.freeze(remove) });
}

/** Whether a patch would change anything. */
export function isEmptyPatch(patch: CustomPropertyPatch): boolean {
  return Object.keys(patch.set).length === 0 && patch.remove.length === 0;
}

/**
 * Lists token ids that cannot be emitted.
 *
 * Reported at load so a theme with an unusable token id fails validation rather
 * than rendering with silent gaps (TH-3, P-9).
 */
export function findUnemittableTokenIds(ids: Iterable<TokenId>): readonly TokenId[] {
  const bad: TokenId[] = [];
  for (const id of ids) {
    if (!isEmittableTokenId(id)) bad.push(id);
  }
  return bad;
}
