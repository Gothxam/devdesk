/**
 * What is actually worth drawing.
 *
 * A surface fully covered by an opaque one above it will not be seen, and
 * drawing it is work with no output. Deciding that here rather than in the
 * renderer keeps the answer in one place and makes it testable without a
 * renderer.
 *
 * ## Deliberately conservative
 *
 * Only a surface fully covered by **one single** opaque surface is culled. Two
 * opaque surfaces that between them cover a third leave it in the scene, even
 * though nothing of it will be visible.
 *
 * That is a real limitation and it is the right trade at this size. Exact
 * coverage means maintaining a region — a set of disjoint rectangles, subtracted
 * and re-merged per surface — and at the surface counts this system has (24 in
 * `ADR-0002`'s W2 workload) the bookkeeping costs more than the drawing it
 * saves. The conservative test is one rectangle comparison per pair above.
 *
 * Being wrong in this direction is safe: a surface that could have been culled
 * is drawn, which wastes work. Being wrong the other way would drop something
 * the user should see, which is a defect.
 */

import type { SurfaceId } from '@devdesk/contracts';

import { encloses } from './geometry';
import type { CompositionScene } from './scene';
import { isOccluding, isPainted, type CompositionSurface } from './surface';

/** What a scene actually needs drawn, and what it does not. */
export interface OcclusionResult {
  /** Surfaces to draw, in paint order. */
  readonly visible: readonly CompositionSurface[];
  /** Surfaces fully covered by something opaque above them. */
  readonly occluded: readonly CompositionSurface[];
}

/**
 * Splits a scene into what must be drawn and what is hidden.
 *
 * Walks top to bottom so each surface is tested only against the opaque
 * surfaces already known to be above it.
 */
export function cullOccluded(scene: CompositionScene): OcclusionResult {
  const visible: CompositionSurface[] = [];
  const occluded: CompositionSurface[] = [];

  // Opaque surfaces seen so far, which are the ones above the surface under
  // consideration because the walk is top-down.
  const covers: CompositionSurface[] = [];

  for (let index = scene.ordered.length - 1; index >= 0; index -= 1) {
    const surface = scene.ordered[index];
    if (!surface) continue;

    // Not drawn at all — invisible, detached, or fully transparent. Neither
    // visible nor occluded: it was never going to be painted, and reporting it
    // as occluded would suggest something is covering it.
    if (!isPainted(surface)) continue;

    const hidden = covers.some(
      (above) => above.monitorId === surface.monitorId && encloses(above.rect, surface.rect),
    );

    if (hidden) occluded.push(surface);
    else visible.push(surface);

    // Only an opaque, unblurred surface can hide anything, and only if it is
    // itself being drawn.
    if (isOccluding(surface)) covers.push(surface);
  }

  // Back to paint order: callers draw bottom-up.
  visible.reverse();
  occluded.reverse();

  return Object.freeze({
    visible: Object.freeze(visible),
    occluded: Object.freeze(occluded),
  });
}

/** Whether one particular surface is hidden in this scene. */
export function isOccluded(scene: CompositionScene, surfaceId: SurfaceId): boolean {
  return cullOccluded(scene).occluded.some((surface) => surface.surfaceId === surfaceId);
}
