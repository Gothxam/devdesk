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
 * What a token *is*, declared by the schema rather than inferred from its name.
 *
 * The engine acts on kinds, never on naming. Inferring semantics from a string
 * prefix is brittle in the one place brittleness is least acceptable: a theme
 * author who writes `moiton.duration.fast` would get a token that resolves
 * perfectly and silently keeps animating under reduced motion. A misspelled
 * *kind* fails validation at load and names the offending token (TH-3, P-9).
 *
 * The set is closed. Adding a kind is a schema change, which is the point.
 */
export const TOKEN_KINDS = [
  'color',
  'dimension',
  'motion-duration',
  'motion-easing',
  'blur-radius',
  'opacity',
  'shadow',
  'typography',
] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];

/** Whether a string names a known {@link TokenKind}. */
export function isTokenKind(value: string): value is TokenKind {
  return (TOKEN_KINDS as readonly string[]).includes(value);
}

/**
 * The inheritance layers, in resolution order.
 *
 * A token may reference **downward only** — component → semantic → base. A base
 * token must be a literal. This direction is enforced during resolution rather
 * than trusted: an inverted reference makes the cascade order meaningless, and
 * the failure appears later as a value that changes with iteration order.
 */
export const LAYERS = ['base', 'semantic', 'component'] as const;

export type TokenLayer = (typeof LAYERS)[number];

/** How far a layer may reach. Lower index = more primitive. */
export function layerRank(layer: TokenLayer): number {
  return LAYERS.indexOf(layer);
}

/**
 * How a token's value is expressed.
 *
 * A reference may declare a `fallback`. TH-3 requires resolution to be **total**:
 * every reference resolves to a concrete value or to a declared fallback, and an
 * unresolvable token fails validation at load rather than at paint.
 */
export type TokenValueForm =
  | { readonly form: 'literal'; readonly value: string }
  | { readonly form: 'reference'; readonly to: TokenId; readonly fallback?: string };

/** An authored token: what it is, and how its value is expressed. */
export interface TokenDefinition {
  readonly kind: TokenKind;
  readonly value: TokenValueForm;
}

/** A literal token of a declared kind. */
export function literal(kind: TokenKind, value: string): TokenDefinition {
  return { kind, value: { form: 'literal', value } };
}

/**
 * A reference to another token, with an optional total-resolution fallback.
 *
 * The declared kind must match the target's kind; resolution rejects a mismatch.
 * That check is only possible because the schema declares kinds — a naming
 * convention cannot tell a colour from a duration.
 */
export function reference(kind: TokenKind, to: string, fallback?: string): TokenDefinition {
  return {
    kind,
    value:
      fallback === undefined
        ? { form: 'reference', to: tokenId(to) }
        : { form: 'reference', to: tokenId(to), fallback },
  };
}

/** The authored tokens of one layer. */
export type TokenLayerSource = Readonly<Record<string, TokenDefinition>>;

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
