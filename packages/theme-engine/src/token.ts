/**
 * The token model.
 *
 * A token is a single named visual value — colour, spacing, radius, blur, shadow,
 * duration, easing (`PROJECT_CONTEXT.md` §28.3). Every visual value in DevDesk is
 * one (P-4, D-4), including inside third-party surfaces.
 *
 * This module describes *authored* tokens. Authored tokens may reference each
 * other; resolved tokens never do. See `resolve.ts`.
 */

/** A token's name, e.g. `surface.glass.tint`. */
export type TokenId = string & { readonly __brand: 'TokenId' };

/** Narrows a string to a {@link TokenId}. */
export function tokenId(value: string): TokenId {
  return value as TokenId;
}

/**
 * The inheritance layers, in resolution order.
 *
 * A token may reference **downward only** — component → semantic → base. A base
 * token must be a literal. This direction is enforced during resolution rather
 * than trusted: an inverted reference makes the cascade order meaningless, and
 * the failure appears later as a value that changes depending on iteration order.
 */
export const LAYERS = ['base', 'semantic', 'component'] as const;

export type TokenLayer = (typeof LAYERS)[number];

/** How far a layer may reach. Lower index = more primitive. */
export function layerRank(layer: TokenLayer): number {
  return LAYERS.indexOf(layer);
}

/**
 * An authored token value.
 *
 * A reference may declare a `fallback`. TH-3 requires resolution to be **total**:
 * every reference resolves to a concrete value or to a declared fallback, and an
 * unresolvable token fails validation at load rather than at paint.
 */
export type TokenValue =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'reference'; readonly to: TokenId; readonly fallback?: string };

/** A literal token value. */
export function literal(value: string): TokenValue {
  return { kind: 'literal', value };
}

/** A reference to another token, with an optional total-resolution fallback. */
export function reference(to: string, fallback?: string): TokenValue {
  return fallback === undefined
    ? { kind: 'reference', to: tokenId(to) }
    : { kind: 'reference', to: tokenId(to), fallback };
}

/** The authored tokens of one layer. */
export type TokenLayerSource = Readonly<Record<string, TokenValue>>;

/** The authored tokens of one mode, across all three layers. */
export interface TokenSet {
  readonly base: TokenLayerSource;
  readonly semantic: TokenLayerSource;
  readonly component: TokenLayerSource;
}

export type ThemeMode = 'light' | 'dark';

/**
 * A theme as authored: data, never code (TH-1).
 *
 * No JavaScript, no WASM, no scripting hooks, no expression language with side
 * effects. Themes are the lowest-friction thing anyone installs, which makes them
 * the highest-value attack surface on the platform — a theme install must never
 * be able to become code execution.
 */
export interface ThemeSource {
  readonly id: string;
  readonly name: string;
  readonly modes: Readonly<Record<ThemeMode, TokenSet>>;
}
