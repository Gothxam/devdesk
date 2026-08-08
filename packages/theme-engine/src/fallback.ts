/**
 * The embedded fallback snapshot.
 *
 * P-10: there is always a way back to a working desktop. That guarantee cannot
 * depend on a file, because a file can be missing, corrupt, or replaced by a
 * theme that fails validation — and those are exactly the situations in which
 * the guarantee is needed.
 *
 * ## Why this bypasses resolution
 *
 * The fallback is constructed **directly**, not resolved from an embedded
 * source. If resolution were in the path, then a defect in the resolver would
 * take out the recovery path along with the thing it is recovering from. The
 * floor must not stand on the thing that fell.
 *
 * It is therefore the one place in the system where token values are written
 * literally rather than authored as a theme. That is not an exception to P-4 —
 * these *are* tokens, emitted through the same pipeline — it is the difference
 * between a theme and the last resort beneath every theme.
 *
 * ## What it is not
 *
 * Not a design. It is legible, high-contrast, and boring on purpose: it exists
 * so a user can see and operate the desktop long enough to fix what broke
 * (LC-9). External default themes are replaceable assets; this is not.
 */

import { THEME_SNAPSHOT_VERSION, type ThemeSnapshot, freezeSnapshot } from './snapshot';
import { type ThemeMode, type TokenId, tokenId } from './token';

/** The identifier reported when the fallback is in use. */
export const FALLBACK_THEME_ID = 'devdesk.embedded-fallback';

const DARK: readonly (readonly [string, string])[] = [
  ['color.canvas', '#101216'],
  ['color.ink', '#f2f4f8'],
  ['color.accent', '#7aa2ff'],
  ['motion.base', '0ms'],
  ['surface.background', '#101216'],
  ['surface.foreground', '#f2f4f8'],
  ['surface.accent', '#7aa2ff'],
  ['motion.transition', '0ms'],
];

const LIGHT: readonly (readonly [string, string])[] = [
  ['color.canvas', '#ffffff'],
  ['color.ink', '#101216'],
  ['color.accent', '#1f4bd8'],
  ['motion.base', '0ms'],
  ['surface.background', '#ffffff'],
  ['surface.foreground', '#101216'],
  ['surface.accent', '#1f4bd8'],
  ['motion.transition', '0ms'],
];

function build(mode: ThemeMode, entries: readonly (readonly [string, string])[]): ThemeSnapshot {
  const tokens = new Map<TokenId, string>();
  const origins = new Map<TokenId, 'embedded'>();

  for (const [name, value] of entries) {
    tokens.set(tokenId(name), value);
    origins.set(tokenId(name), 'embedded');
  }

  return freezeSnapshot({
    version: THEME_SNAPSHOT_VERSION,
    // Stable and reserved: the fallback is not a resolution of any source, so it
    // has no input hash. A distinct constant keeps it from ever colliding with
    // a real theme's hash and diffing to nothing against one.
    hash: `embedded-${mode}`,
    tokens,
    origins,
    accessibilityOverrides: new Set(),
    metadata: {
      themeId: FALLBACK_THEME_ID,
      themeName: 'DevDesk Fallback',
      mode,
      tokenCount: tokens.size,
      overrideCount: 0,
    },
  });
}

const SNAPSHOTS: Readonly<Record<ThemeMode, ThemeSnapshot>> = Object.freeze({
  dark: build('dark', DARK),
  light: build('light', LIGHT),
});

/**
 * The embedded fallback for a mode.
 *
 * Motion is already neutralised, so the fallback is safe under any accessibility
 * preference without needing to resolve overrides — one less code path between
 * a broken desktop and a usable one.
 */
export function fallbackSnapshot(mode: ThemeMode): ThemeSnapshot {
  return SNAPSHOTS[mode];
}

/** Whether a snapshot is the embedded fallback. */
export function isFallbackSnapshot(snapshot: ThemeSnapshot): boolean {
  return snapshot.metadata.themeId === FALLBACK_THEME_ID;
}
