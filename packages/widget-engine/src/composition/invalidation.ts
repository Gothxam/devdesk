/**
 * What changed, and what therefore has to be redrawn.
 *
 * ## Computed by comparison, not reported by callers
 *
 * Nothing tells the compositor "this surface moved". Two scenes are compared and
 * the difference falls out. A caller that had to report its own changes would
 * eventually forget one, and the symptom — a surface that does not repaint until
 * something unrelated happens — is close to undiagnosable.
 *
 * It costs a walk over both scenes per change. Scenes change on user action and
 * on topology events, not per frame, and the walk is linear in surface count.
 *
 * ## Damage is a single rectangle
 *
 * Not a region. The union of everything that changed, which for a moved surface
 * is its old rectangle *and* its new one — both have to be repainted, one to
 * remove it and one to draw it.
 *
 * A single rectangle over-reports: two surfaces changing at opposite corners
 * damage the whole desktop between them. The alternative is a region — a set of
 * disjoint rectangles maintained through subtraction and merging — and at the
 * surface counts this system has, that bookkeeping costs more than the extra
 * pixels. The renderer is a browser compositor that will do its own damage
 * tracking underneath anyway; what it needs from us is "something in this area
 * changed", not a minimal cover.
 *
 * `surfaces` carries the per-surface detail for a caller that wants to be
 * cleverer than the union.
 */

import type { SurfaceId } from '@devdesk/contracts';

import { EMPTY_RECT, isEmpty, type Rect, union } from './geometry';
import type { CompositionScene } from './scene';
import { equalSurfaces, isPainted, type CompositionSurface } from './surface';

/** Why a surface needs redrawing. */
export type InvalidationReason =
  /** It was not in the previous scene. */
  | 'added'
  /** It is not in the current scene. */
  | 'removed'
  /** Its rectangle changed. */
  | 'moved'
  /** Its opacity, blur, or tint changed. */
  | 'appearance'
  /** It became visible or stopped being visible. */
  | 'visibility'
  /** It changed band, so paint order changed with it. */
  | 'layer'
  /** It moved to another display, or lost the one it had. */
  | 'monitor'
  /** Its ordinal changed, so paint order changed. */
  | 'order'
  /** Its pointer mode changed. No pixels move; hit testing changes. */
  | 'pointer';

/** Every reason, in the order they are reported. */
export const INVALIDATION_REASONS: readonly InvalidationReason[] = Object.freeze([
  'added',
  'removed',
  'moved',
  'appearance',
  'visibility',
  'layer',
  'monitor',
  'order',
  'pointer',
]);

/** One surface's change. */
export interface SurfaceInvalidation {
  readonly surfaceId: SurfaceId;
  /** Deduplicated, in {@link INVALIDATION_REASONS} order. Never empty. */
  readonly reasons: readonly InvalidationReason[];
  /** Where it was, if it was anywhere. */
  readonly before: Rect | undefined;
  /** Where it is, if it is anywhere. */
  readonly after: Rect | undefined;
  /** The area to repaint for this surface alone. */
  readonly damage: Rect;
}

/** Everything that changed between two scenes. */
export interface Invalidation {
  readonly surfaces: readonly SurfaceInvalidation[];
  /** The union of every surface's damage. */
  readonly damage: Rect;
  /** Whether nothing changed at all. */
  readonly isEmpty: boolean;
  /**
   * Whether paint order changed.
   *
   * A renderer that keeps a display list can skip rebuilding it when this is
   * false, even though individual surfaces moved.
   */
  readonly reordered: boolean;
  /**
   * Whether only hit testing is affected.
   *
   * A pointer-mode change repaints nothing. A caller that separates input
   * routing from painting can act on this without scheduling a frame.
   */
  readonly pointerOnly: boolean;
}

/** Nothing changed. */
export const NO_INVALIDATION: Invalidation = Object.freeze({
  surfaces: Object.freeze([]),
  damage: EMPTY_RECT,
  isEmpty: true,
  reordered: false,
  pointerOnly: false,
});

/** The reasons one surface changed between two states. */
function reasonsFor(
  before: CompositionSurface | undefined,
  after: CompositionSurface | undefined,
): InvalidationReason[] {
  if (!before && after) return ['added'];
  if (before && !after) return ['removed'];
  if (!before || !after) return [];

  const reasons: InvalidationReason[] = [];

  if (before.rect.x !== after.rect.x || before.rect.y !== after.rect.y) reasons.push('moved');
  else if (before.rect.width !== after.rect.width || before.rect.height !== after.rect.height) {
    reasons.push('moved');
  }

  if (
    before.appearance.opacity !== after.appearance.opacity ||
    before.appearance.blurRadius !== after.appearance.blurRadius ||
    before.appearance.tint !== after.appearance.tint
  ) {
    reasons.push('appearance');
  }

  if (before.isVisible !== after.isVisible) reasons.push('visibility');
  if (before.layer !== after.layer) reasons.push('layer');
  if (before.monitorId !== after.monitorId) reasons.push('monitor');
  if (before.ordinal !== after.ordinal) reasons.push('order');
  if (before.pointerMode !== after.pointerMode) reasons.push('pointer');

  return reasons;
}

/**
 * The area to repaint for one surface's change.
 *
 * Both rectangles for a move: one to erase where it was, one to draw where it
 * is. Only the painted state contributes — a surface that was invisible before
 * and is invisible now damages nothing wherever it sits.
 */
function damageFor(
  before: CompositionSurface | undefined,
  after: CompositionSurface | undefined,
): Rect {
  const from = before && isPainted(before) ? before.rect : EMPTY_RECT;
  const to = after && isPainted(after) ? after.rect : EMPTY_RECT;
  return union(from, to);
}

/**
 * Compares two scenes.
 *
 * The surfaces are reported in identity order so two runs over the same change
 * produce the same list — a caller logging or diffing invalidations would
 * otherwise see spurious differences.
 */
export function invalidate(before: CompositionScene, after: CompositionScene): Invalidation {
  const ids = new Set<SurfaceId>();
  for (const surface of before.ordered) ids.add(surface.surfaceId);
  for (const surface of after.ordered) ids.add(surface.surfaceId);

  const surfaces: SurfaceInvalidation[] = [];
  let damage = EMPTY_RECT;
  let reordered = false;

  for (const surfaceId of [...ids].sort()) {
    const was = before.get(surfaceId);
    const is = after.get(surfaceId);

    if (was && is && equalSurfaces(was, is)) continue;

    const reasons = reasonsFor(was, is);
    if (reasons.length === 0) continue;

    const surfaceDamage = damageFor(was, is);
    damage = union(damage, surfaceDamage);

    if (
      reasons.includes('added') ||
      reasons.includes('removed') ||
      reasons.includes('layer') ||
      reasons.includes('order')
    ) {
      reordered = true;
    }

    surfaces.push(
      Object.freeze({
        surfaceId,
        reasons: Object.freeze(INVALIDATION_REASONS.filter((reason) => reasons.includes(reason))),
        before: was?.rect,
        after: is?.rect,
        damage: surfaceDamage,
      }),
    );
  }

  if (surfaces.length === 0) return NO_INVALIDATION;

  const pointerOnly = surfaces.every(
    (entry) => entry.reasons.length === 1 && entry.reasons[0] === 'pointer',
  );

  return Object.freeze({
    surfaces: Object.freeze(surfaces),
    damage,
    isEmpty: false,
    reordered,
    pointerOnly,
  });
}

/** Whether an invalidation asks for any pixels to change. */
export function needsRepaint(invalidation: Invalidation): boolean {
  return !invalidation.isEmpty && !invalidation.pointerOnly && !isEmpty(invalidation.damage);
}

/**
 * Folds two invalidations into one.
 *
 * Used when frames are dropped: three scene changes between two paints become
 * one invalidation describing the whole distance. Reasons and damage merge; the
 * `before` of the earlier and the `after` of the later are kept, so a surface
 * that moved twice reports the distance actually travelled rather than the last
 * hop.
 */
export function mergeInvalidations(earlier: Invalidation, later: Invalidation): Invalidation {
  if (earlier.isEmpty) return later;
  if (later.isEmpty) return earlier;

  const byId = new Map<SurfaceId, SurfaceInvalidation>();
  for (const entry of earlier.surfaces) byId.set(entry.surfaceId, entry);

  for (const entry of later.surfaces) {
    const existing = byId.get(entry.surfaceId);
    if (!existing) {
      byId.set(entry.surfaceId, entry);
      continue;
    }

    const reasons = new Set([...existing.reasons, ...entry.reasons]);
    byId.set(entry.surfaceId, {
      surfaceId: entry.surfaceId,
      reasons: Object.freeze(INVALIDATION_REASONS.filter((reason) => reasons.has(reason))),
      before: existing.before,
      after: entry.after,
      damage: union(existing.damage, entry.damage),
    });
  }

  const surfaces = [...byId.values()].sort((a, b) =>
    a.surfaceId < b.surfaceId ? -1 : a.surfaceId > b.surfaceId ? 1 : 0,
  );

  return Object.freeze({
    surfaces: Object.freeze(surfaces),
    damage: union(earlier.damage, later.damage),
    isEmpty: false,
    reordered: earlier.reordered || later.reordered,
    pointerOnly: earlier.pointerOnly && later.pointerOnly,
  });
}
