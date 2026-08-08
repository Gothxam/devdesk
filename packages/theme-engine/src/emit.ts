/**
 * Emission: turning a resolved snapshot into CSS custom properties.
 *
 * This is a **pure transform**, deliberately separated from resolution. The
 * engine resolves tokens; emission renders one snapshot into one output format.
 * Neither module touches a document — applying properties is the shell's job.
 *
 * The separation is what makes "token-resolution system, not CSS theme system"
 * true in the code rather than in a comment: a second emission target (a native
 * surface backend, §26.1) is a new function here, not a change to the engine.
 *
 * Custom properties are the emission target because TH-4 requires theme switching
 * to re-emit properties on the root rather than remount the tree — that is what
 * makes `PB-R4` reachable at all.
 */

import type { ThemeSnapshot } from './snapshot';
import type { TokenId } from './token';

/** Characters permitted in a token id. */
const VALID_TOKEN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Converts a token id to a CSS custom property name.
 *
 * `surface.glass.tint` becomes `--surface-glass-tint`.
 */
export function customPropertyName(id: TokenId): string {
  return `--${id.replaceAll('.', '-')}`;
}

/** Whether a token id can be emitted as a custom property. */
export function isEmittableTokenId(id: string): boolean {
  return VALID_TOKEN_ID.test(id);
}

/**
 * Renders a snapshot as custom properties.
 *
 * Tokens whose ids cannot be expressed as a property name are omitted rather
 * than emitted malformed — a malformed property is silently ignored by the
 * browser, which is exactly the silent failure P-9 prohibits. Use
 * {@link findUnemittableTokens} to surface them at validation time instead.
 */
export function toCustomProperties(snapshot: ThemeSnapshot): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, value] of snapshot.tokens) {
    if (!isEmittableTokenId(id)) continue;
    out[customPropertyName(id)] = value;
  }
  return Object.freeze(out);
}

/**
 * Lists tokens that cannot be emitted.
 *
 * Reported at load so a theme with an unusable token id fails validation rather
 * than rendering with silent gaps (TH-3, P-9).
 */
export function findUnemittableTokens(snapshot: ThemeSnapshot): readonly TokenId[] {
  const bad: TokenId[] = [];
  for (const id of snapshot.tokens.keys()) {
    if (!isEmittableTokenId(id)) bad.push(id);
  }
  return bad;
}

/**
 * Computes the properties that differ between two snapshots.
 *
 * Theme switching applies a diff rather than the whole set. With a dozen
 * surfaces this is the difference between touching every property on every
 * surface and touching the handful that changed — which is what keeps switching
 * inside `PB-R4` as the token set grows.
 *
 * Returns `null` for a property that exists in `from` but not `to`, so the caller
 * can remove it rather than leave a stale value behind.
 */
export function diffCustomProperties(
  from: ThemeSnapshot | undefined,
  to: ThemeSnapshot,
): Readonly<Record<string, string | null>> {
  const next = toCustomProperties(to);
  if (from === undefined) return next;

  const previous = toCustomProperties(from);
  const changes: Record<string, string | null> = {};

  for (const [name, value] of Object.entries(next)) {
    if (previous[name] !== value) changes[name] = value;
  }
  for (const name of Object.keys(previous)) {
    if (!(name in next)) changes[name] = null;
  }

  return Object.freeze(changes);
}
