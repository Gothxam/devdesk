/**
 * A surface, as the compositor sees it.
 *
 * ## Not the same thing as a widget
 *
 * Nothing here knows what a widget is. A `CompositionSurface` is a rectangle, a
 * band, a visibility, and some effect intent — the facts needed to decide what
 * is on top of what, what a click lands on, and what has to be redrawn. Its
 * identity is a {@link SurfaceId}, which is the core's, not the runtime's.
 *
 * That independence is the point. The compositor consumes the window
 * subsystem's output and the theme, and a change to how widgets work must not
 * be able to reach it.
 *
 * ## Immutable
 *
 * A surface is replaced, never mutated, and the whole scene is replaced with it.
 * A compositor that mutated surfaces in place would let a hit test and a paint
 * describing one frame disagree — the same argument `WD-11` makes for
 * `DisplayGraph` and the theme snapshot makes for tokens.
 */

import type { MonitorId, SurfaceId } from '@devdesk/contracts';

import { equalRects, type Rect } from './geometry';
import { type CompositionLayer, DEFAULT_LAYER, layerDepth } from './layer';

/**
 * Whether a surface takes input.
 *
 * Separate from visibility because they are genuinely independent: a HUD that is
 * visible and click-through lets the desktop underneath be used, and a surface
 * that is invisible but still takes input is a bug that presents as clicks
 * vanishing.
 */
export type PointerMode =
  /** Takes clicks that land on it. */
  | 'interactive'
  /** Clicks pass through to whatever is underneath. */
  | 'click-through';

/**
 * How a surface is drawn, as intent rather than as pixels.
 *
 * The compositor decides *what* should look how; `@devdesk/effects` owns the
 * primitives that make it so (§6.2.2). Keeping intent here and implementation
 * there is what stops a compositor from acquiring opinions about `backdrop-filter`
 * (`AP-3`).
 */
export interface SurfaceAppearance {
  /** `0` transparent, `1` opaque. Clamped on construction. */
  readonly opacity: number;
  /**
   * Backdrop blur radius in logical pixels. `0` means none.
   *
   * A *request*. Whether it is honoured is the effects package's decision, and
   * from M2 a budgeted one — this is the only place the compositor states an
   * opinion about it.
   */
  readonly blurRadius: number;
  /** Tint colour over the blurred backdrop, or `undefined` for none. */
  readonly tint: string | undefined;
}

/** Fully opaque, no blur, no tint. */
export const OPAQUE: SurfaceAppearance = Object.freeze({
  opacity: 1,
  blurRadius: 0,
  tint: undefined,
});

/** What the compositor knows about one surface. */
export interface CompositionSurface {
  readonly surfaceId: SurfaceId;
  /** The display it is on, or `undefined` when none is attached. */
  readonly monitorId: MonitorId | undefined;
  /** Where it is, in logical pixels. Supplied; never computed here. */
  readonly rect: Rect;
  readonly layer: CompositionLayer;
  /**
   * Whether it is drawn at all.
   *
   * A surface that is not visible is still in the scene: it keeps its place, its
   * band, and its identity, and it is skipped by painting and by hit testing.
   * Removing it instead would lose the fact that it exists, and the surface
   * would have to be rebuilt to come back.
   */
  readonly isVisible: boolean;
  readonly pointerMode: PointerMode;
  readonly appearance: SurfaceAppearance;
  /**
   * Tie-break for two surfaces in the same band.
   *
   * **Not user-facing z-order** — that is M1. This exists because two surfaces
   * in one band need a total order for painting to be deterministic, and
   * "whatever order the map iterated" is not one. Supplied by whoever creates
   * the surface and stable for its lifetime.
   */
  readonly ordinal: number;
}

/** The fields a caller must supply; the rest have defaults. */
export interface CompositionSurfaceInit {
  readonly surfaceId: SurfaceId;
  readonly rect: Rect;
  readonly monitorId?: MonitorId | undefined;
  readonly layer?: CompositionLayer;
  readonly isVisible?: boolean;
  readonly pointerMode?: PointerMode;
  readonly appearance?: Partial<SurfaceAppearance>;
  readonly ordinal?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Builds a frozen composition surface. */
export function createCompositionSurface(init: CompositionSurfaceInit): CompositionSurface {
  const appearance = init.appearance ?? {};

  return Object.freeze({
    surfaceId: init.surfaceId,
    monitorId: init.monitorId,
    rect: init.rect,
    layer: init.layer ?? DEFAULT_LAYER,
    // Visible by default. A surface added to the scene invisible and forgotten
    // about is far harder to notice than one that appears when it should not.
    isVisible: init.isVisible ?? true,
    pointerMode: init.pointerMode ?? 'interactive',
    appearance: Object.freeze({
      opacity: clamp01(appearance.opacity ?? OPAQUE.opacity),
      blurRadius: Math.max(0, appearance.blurRadius ?? OPAQUE.blurRadius),
      tint: appearance.tint ?? OPAQUE.tint,
    }),
    ordinal: init.ordinal ?? 0,
  });
}

/** Returns a surface with some fields changed, leaving the original alone. */
export function withSurface(
  surface: CompositionSurface,
  changes: Partial<Omit<CompositionSurfaceInit, 'surfaceId'>>,
): CompositionSurface {
  return createCompositionSurface({
    surfaceId: surface.surfaceId,
    rect: changes.rect ?? surface.rect,
    monitorId: 'monitorId' in changes ? changes.monitorId : surface.monitorId,
    layer: changes.layer ?? surface.layer,
    isVisible: changes.isVisible ?? surface.isVisible,
    pointerMode: changes.pointerMode ?? surface.pointerMode,
    appearance: { ...surface.appearance, ...changes.appearance },
    ordinal: changes.ordinal ?? surface.ordinal,
  });
}

/**
 * Total order for painting: band first, then ordinal, then identity.
 *
 * Identity last so the order is total even when two surfaces agree on
 * everything else. Without it, two surfaces with the same band and ordinal would
 * sort by whatever the sort happened to do, and the desktop would repaint in a
 * different order on a different run — which shows up as flicker nobody can
 * reproduce.
 */
export function compareSurfaces(a: CompositionSurface, b: CompositionSurface): number {
  const byLayer = layerDepth(a.layer) - layerDepth(b.layer);
  if (byLayer !== 0) return byLayer;

  const byOrdinal = a.ordinal - b.ordinal;
  if (byOrdinal !== 0) return byOrdinal;

  return a.surfaceId < b.surfaceId ? -1 : a.surfaceId > b.surfaceId ? 1 : 0;
}

/** Whether a surface would be drawn: visible, on a display, and not transparent. */
export function isPainted(surface: CompositionSurface): boolean {
  return surface.isVisible && surface.monitorId !== undefined && surface.appearance.opacity > 0;
}

/** Whether a surface would take a click that landed on it. */
export function takesPointer(surface: CompositionSurface): boolean {
  return isPainted(surface) && surface.pointerMode === 'interactive';
}

/**
 * Whether a surface hides whatever is behind it.
 *
 * Only a fully opaque, unblurred one does. A blurred surface samples what is
 * behind it, so treating it as occluding would let the compositor skip drawing
 * the very thing the blur is of.
 */
export function isOccluding(surface: CompositionSurface): boolean {
  return isPainted(surface) && surface.appearance.opacity >= 1 && surface.appearance.blurRadius === 0;
}

/** Whether two surfaces describe the same composited result. */
export function equalSurfaces(a: CompositionSurface, b: CompositionSurface): boolean {
  return (
    a.surfaceId === b.surfaceId &&
    a.monitorId === b.monitorId &&
    a.layer === b.layer &&
    a.isVisible === b.isVisible &&
    a.pointerMode === b.pointerMode &&
    a.ordinal === b.ordinal &&
    a.appearance.opacity === b.appearance.opacity &&
    a.appearance.blurRadius === b.appearance.blurRadius &&
    a.appearance.tint === b.appearance.tint &&
    equalRects(a.rect, b.rect)
  );
}
