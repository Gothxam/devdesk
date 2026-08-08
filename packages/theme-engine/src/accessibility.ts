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
 * ## Overrides act on declared kind, never on naming
 *
 * The engine reads {@link TokenDefinition.kind}, which the schema declares. It
 * never infers meaning from a token's name. A theme that misspells a token id
 * still gets its motion neutralised, because the kind is what carries the
 * semantics; a theme that misspells a *kind* fails validation and is told which
 * token is wrong.
 */

import type { AccessibilityPreferences } from './resolve';
import type { ThemeSnapshot } from './snapshot';
import type { TokenDefinition, TokenId, TokenKind, TokenSet } from './token';
import { tokenId } from './token';

/** What an active preference forces a kind to, and how that reads to a user. */
interface OverrideRule {
  readonly forced: string;
  readonly label: string;
  readonly applies: (preferences: AccessibilityPreferences) => boolean;
}

/**
 * The complete override table.
 *
 * Keyed by kind, so adding a kind that needs neutralising is a change here and
 * nowhere else. A kind absent from this table is never overridden.
 */
const RULES: Partial<Record<TokenKind, OverrideRule>> = {
  'motion-duration': {
    forced: '0ms',
    label: 'Reduced motion',
    applies: (p) => p.reducedMotion,
  },
  'blur-radius': {
    forced: '0px',
    label: 'Reduced transparency',
    applies: (p) => p.reducedTransparency,
  },
  opacity: {
    forced: '1',
    label: 'Reduced transparency',
    applies: (p) => p.reducedTransparency,
  },
};

/**
 * Computes the overrides for a set of preferences.
 *
 * Takes declared tokens rather than a snapshot so it can run before resolution
 * completes — the overrides are applied inside `resolveTheme` after every
 * reference is resolved, which is what makes them un-shadowable.
 */
export function accessibilityOverrides(
  declared: ReadonlyMap<TokenId, TokenDefinition>,
  preferences: AccessibilityPreferences,
): ReadonlyMap<TokenId, string> {
  const overrides = new Map<TokenId, string>();

  for (const [id, definition] of declared) {
    const rule = RULES[definition.kind];
    if (rule !== undefined && rule.applies(preferences)) {
      overrides.set(id, rule.forced);
    }
  }

  return overrides;
}

/** Every declared token of one mode, flattened across the three layers. */
export function declaredTokens(set: TokenSet): ReadonlyMap<TokenId, TokenDefinition> {
  const flat = new Map<TokenId, TokenDefinition>();
  for (const layer of [set.base, set.semantic, set.component]) {
    for (const [name, definition] of Object.entries(layer)) {
      flat.set(tokenId(name), definition);
    }
  }
  return flat;
}

/** Whether any preference is active. */
export function hasActiveOverrides(preferences: AccessibilityPreferences): boolean {
  return preferences.reducedMotion || preferences.reducedTransparency || preferences.highContrast;
}

/**
 * Names the preferences that overrode values in a resolved snapshot.
 *
 * Reads the snapshot's own record rather than recomputing, so what the user is
 * told matches what was actually applied (`AC-THM-6.2`).
 */
export function describeActiveOverrides(
  snapshot: ThemeSnapshot,
  declared: ReadonlyMap<TokenId, TokenDefinition>,
): readonly string[] {
  const labels = new Set<string>();
  for (const id of snapshot.accessibilityOverrides) {
    const kind = declared.get(id)?.kind;
    const rule = kind === undefined ? undefined : RULES[kind];
    if (rule !== undefined) labels.add(rule.label);
  }
  return [...labels];
}
