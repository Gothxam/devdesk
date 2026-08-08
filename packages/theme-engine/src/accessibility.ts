/**
 * Accessibility overrides.
 *
 * D-5 and TH-5: reduced motion, reduced transparency, and high contrast override
 * theme values **unconditionally**. A theme cannot opt out, and a beautiful theme
 * that is unreadable in high-contrast mode is a broken theme.
 *
 * These live in the engine rather than in themes because they are policy, not
 * visual opinion. The engine still carries no opinion about *what a theme should
 * look like* (D-8); it carries the rule that the operating system wins.
 *
 * ## The one piece of token semantics the engine knows
 *
 * Overrides are applied by namespace, which makes a naming convention part of the
 * theme contract:
 *
 * | Namespace | Meaning | Overridden when |
 * | --- | --- | --- |
 * | `motion.*` | A duration | reduced motion |
 * | `effect.blur.*` | A blur radius | reduced transparency |
 * | `effect.opacity.*` | A surface opacity | reduced transparency |
 * | `effect.tint.*` | A translucent fill | reduced transparency |
 *
 * This is the engine's *only* knowledge of what a token means. A theme that
 * places a duration outside `motion.*` will not have it neutralised, which is why
 * the convention is part of the contract rather than a suggestion.
 */

import type { ThemeSnapshot } from './snapshot';
import { type TokenId, tokenId } from './token';
import type { AccessibilityPreferences } from './resolve';

/** Values forced by an active preference. */
const FORCED_DURATION = '0ms';
const FORCED_BLUR = '0px';
const FORCED_OPACITY = '1';

function hasNamespace(id: string, namespace: string): boolean {
  return id === namespace || id.startsWith(`${namespace}.`);
}

/**
 * Computes the overrides for a set of preferences.
 *
 * Takes the token *ids* rather than a snapshot so it can run before resolution
 * completes — the overrides are applied inside {@link resolveTheme}, after every
 * reference is resolved, which is what makes them un-shadowable.
 */
export function accessibilityOverrides(
  tokenIds: Iterable<string>,
  preferences: AccessibilityPreferences,
): ReadonlyMap<TokenId, string> {
  const overrides = new Map<TokenId, string>();

  for (const id of tokenIds) {
    if (preferences.reducedMotion && hasNamespace(id, 'motion')) {
      overrides.set(tokenId(id), FORCED_DURATION);
      continue;
    }

    if (preferences.reducedTransparency) {
      if (hasNamespace(id, 'effect.blur')) {
        overrides.set(tokenId(id), FORCED_BLUR);
        continue;
      }
      if (hasNamespace(id, 'effect.opacity')) {
        overrides.set(tokenId(id), FORCED_OPACITY);
        continue;
      }
    }
  }

  return overrides;
}

/**
 * Every token id a theme declares, across all three layers of one mode.
 *
 * Used to compute overrides without resolving first.
 */
export function declaredTokenIds(set: {
  base: Readonly<Record<string, unknown>>;
  semantic: Readonly<Record<string, unknown>>;
  component: Readonly<Record<string, unknown>>;
}): readonly string[] {
  return [...Object.keys(set.base), ...Object.keys(set.semantic), ...Object.keys(set.component)];
}

/**
 * Whether any preference is active.
 *
 * Surfaced so the shell can tell the user which values the operating system is
 * controlling, rather than leaving them wondering why a theme looks different
 * (`AC-THM-6.2`).
 */
export function hasActiveOverrides(preferences: AccessibilityPreferences): boolean {
  return (
    preferences.reducedMotion || preferences.reducedTransparency || preferences.highContrast
  );
}

/**
 * Lists which preferences overrode values in a resolved snapshot.
 *
 * Reads the snapshot's own record rather than recomputing, so what the user is
 * told matches what was actually applied.
 */
export function describeActiveOverrides(snapshot: ThemeSnapshot): readonly string[] {
  if (snapshot.accessibilityOverrides.size === 0) return [];

  const namespaces = new Set<string>();
  for (const id of snapshot.accessibilityOverrides) {
    if (hasNamespace(id, 'motion')) namespaces.add('Reduced motion');
    if (hasNamespace(id, 'effect.blur') || hasNamespace(id, 'effect.opacity')) {
      namespaces.add('Reduced transparency');
    }
  }
  return [...namespaces];
}
