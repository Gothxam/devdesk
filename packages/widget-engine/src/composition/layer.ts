/**
 * The z-order bands a surface can occupy.
 *
 * These are `SYSTEM_ARCHITECTURE.md` §9.4's five layers, and they are
 * architecture rather than preference: `WD-7` makes layer assignment declared in
 * the manifest and **granted by the core**, and `WD-9` reserves the top band to
 * the core because that is where capability prompts render and a surface able to
 * draw there could spoof them.
 *
 * ```text
 *   4  system     HUD · notifications · capability prompts   ← core only (WD-9)
 *   3  overlay    always-on-top, non-activating
 *   2  normal     ordinary window behaviour
 *   1  desktop    above wallpaper, below normal windows
 *   0  wallpaper  below desktop icons                        ← blocked on Q-1
 * ```
 *
 * ## What this is not
 *
 * It is **not** user-facing z-order. There is no "bring to front", no per-surface
 * stacking the user controls, and no persisted order — `planning/SPRINT_1.md` §8
 * puts those in M1 alongside snapping, duplicate, lock, and hide.
 *
 * Ordering *within* a band is derived and deterministic (see
 * {@link compareSurfaces}), not commanded. That distinction is the whole reason
 * this file is in scope: a band is where a surface is allowed to be, and the
 * order inside it is a consequence of facts about the surfaces rather than of
 * anything anyone asked for.
 */

/** A z-order band. */
export type CompositionLayer = 'wallpaper' | 'desktop' | 'normal' | 'overlay' | 'system';

/** Every band, bottom to top. */
export const COMPOSITION_LAYERS: readonly CompositionLayer[] = Object.freeze([
  'wallpaper',
  'desktop',
  'normal',
  'overlay',
  'system',
]);

/**
 * The numeric depth of a band, bottom to top.
 *
 * Exposed because a renderer needs a number to sort or to put in a `z-index`,
 * and deriving one from array position at every call site is how two renderers
 * end up disagreeing about which is on top.
 */
export function layerDepth(layer: CompositionLayer): number {
  return COMPOSITION_LAYERS.indexOf(layer);
}

/** Whether `a` composites above `b`. */
export function isAbove(a: CompositionLayer, b: CompositionLayer): boolean {
  return layerDepth(a) > layerDepth(b);
}

/**
 * The band a surface gets when nothing says otherwise.
 *
 * `desktop`, not `normal`. A DevDesk surface is part of the desktop rather than
 * a window competing with the user's applications, and defaulting to `normal`
 * would put every widget in the alt-tab order the first time one was placed.
 */
export const DEFAULT_LAYER: CompositionLayer = 'desktop';

/**
 * Bands a surface may be granted.
 *
 * `system` is absent: `WD-9` reserves it to the core, and the way to enforce
 * that is for the granting path to have no way of naming it. A core-owned
 * surface is constructed with the band directly rather than granted one.
 */
export const GRANTABLE_LAYERS: readonly CompositionLayer[] = Object.freeze([
  'wallpaper',
  'desktop',
  'normal',
  'overlay',
]);

/** Whether a band may be granted to a surface that asked for it. */
export function isGrantable(layer: CompositionLayer): boolean {
  return GRANTABLE_LAYERS.includes(layer);
}

/** Why a requested band was refused. */
export type LayerGrantError =
  | { readonly kind: 'reserved'; readonly layer: CompositionLayer }
  | { readonly kind: 'blocked'; readonly layer: CompositionLayer; readonly reason: string };

/**
 * Decides the band a surface actually gets.
 *
 * Two refusals, and neither is a judgement call:
 *
 * - **`system` is reserved** (`WD-9`). Granting it would put a surface where
 *   capability prompts render.
 * - **`wallpaper` is blocked** on `Q-1`, an open ADR question
 *   (`SYSTEM_ARCHITECTURE.md` Appendix D, `SPRINT_1.md` §8). It needs
 *   platform-specific attachment that `WD-8` says must report `Unsupported`
 *   rather than degrade silently, and that decision has not been taken.
 *
 * A refusal returns the reason rather than quietly substituting a band. A
 * surface that asked to be wallpaper and silently became a desktop widget is a
 * bug report about a widget appearing in the wrong place.
 */
export function grantLayer(
  requested: CompositionLayer,
): { readonly ok: true; readonly layer: CompositionLayer } | { readonly ok: false; readonly error: LayerGrantError } {
  if (requested === 'system') {
    return { ok: false, error: { kind: 'reserved', layer: requested } };
  }

  if (requested === 'wallpaper') {
    return {
      ok: false,
      error: {
        kind: 'blocked',
        layer: requested,
        reason: 'the wallpaper layer is blocked on Q-1 and has no ratified attachment path',
      },
    };
  }

  return { ok: true, layer: requested };
}

/** Renders a refusal as something an author can act on. */
export function describeLayerGrantError(error: LayerGrantError): string {
  switch (error.kind) {
    case 'reserved':
      return `the "${error.layer}" layer is reserved to the core (WD-9)`;
    case 'blocked':
      return `the "${error.layer}" layer is not available: ${error.reason}`;
  }
}
