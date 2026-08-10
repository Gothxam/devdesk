/**
 * From theme tokens to per-surface appearance.
 *
 * ## The compositor reads the theme; it does not have opinions
 *
 * A surface's transparency and blur come from the resolved snapshot — the same
 * tokens a widget reads its colours from — so a theme that says "no glass"
 * makes the whole desktop opaque without any surface knowing. The mapping is
 * one function, so what the theme can express is written in exactly one place.
 *
 * ## Accessibility overrides are not preferences
 *
 * `prefers-reduced-transparency` zeroes both opacity-below-one and blur. It is
 * applied **after** the tokens, so no theme can express its way around it —
 * the same rule the theme engine applies to its own overrides, held here for
 * the one place appearance is computed.
 *
 * ## No budget accounting
 *
 * `SPRINT_1.md` §8 puts effect budgets and automatic degradation in M2, and
 * §6.2.2 gives them to `@devdesk/effects`. This file computes *intent*; whether
 * the GPU can afford it is deliberately not asked here.
 */

import type { ThemeSnapshot } from '@devdesk/theme-engine';
import { tokenId } from '@devdesk/theme-engine';

import { OPAQUE, type SurfaceAppearance } from './surface';

/**
 * The tokens appearance is derived from.
 *
 * Named here once. A theme that wants glass declares them; one that omits them
 * gets an opaque desktop, because absence of a token is absence of the effect —
 * a theme must not gain translucency by forgetting to say otherwise.
 */
export const APPEARANCE_TOKENS = Object.freeze({
  /** `0`–`1`. Surface opacity. */
  opacity: tokenId('surface.glass.opacity'),
  /** Logical pixels of backdrop blur. */
  blur: tokenId('surface.glass.blur'),
  /** A colour laid over the blurred backdrop. */
  tint: tokenId('surface.glass.tint'),
});

/** What reduced transparency leaves standing. */
const FULLY_OPAQUE: SurfaceAppearance = OPAQUE;

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Computes the appearance the theme asks for.
 *
 * Total: a missing token falls back to opaque, a malformed one is ignored, and
 * the result is always a valid appearance. A theme cannot make this throw, which
 * matters because a theme is user-supplied data (`TH-1`).
 */
export function appearanceFromTheme(
  theme: ThemeSnapshot,
  options: { readonly reducedTransparency?: boolean } = {},
): SurfaceAppearance {
  // The override wins over everything the theme says, and it is checked first
  // so no token read can leak into the decision.
  if (options.reducedTransparency) return FULLY_OPAQUE;

  const opacity = parseNumber(theme.tokens.get(APPEARANCE_TOKENS.opacity));
  const blur = parseNumber(theme.tokens.get(APPEARANCE_TOKENS.blur));
  const tint = theme.tokens.get(APPEARANCE_TOKENS.tint);

  return Object.freeze({
    opacity: opacity === undefined ? 1 : Math.min(1, Math.max(0, opacity)),
    blurRadius: blur === undefined ? 0 : Math.max(0, blur),
    tint: tint === undefined || tint.trim().length === 0 ? undefined : tint,
  });
}

/**
 * Whether two appearances would composite identically.
 *
 * Used by the shell to decide whether a theme switch actually changed the glass:
 * most theme switches change colours and leave the glass alone, and re-styling
 * every surface for those would be a repaint nobody can see.
 */
export function equalAppearance(a: SurfaceAppearance, b: SurfaceAppearance): boolean {
  return a.opacity === b.opacity && a.blurRadius === b.blurRadius && a.tint === b.tint;
}
