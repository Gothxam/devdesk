/**
 * Every surface, composed.
 *
 * A `CompositionScene` is an immutable snapshot of what the desktop looks like:
 * which surfaces exist, where they are, what band each is in, and the order they
 * paint in. Changing anything produces a new scene.
 *
 * ## Why immutable, again
 *
 * The same argument as `DisplayGraph` (`WD-11`) and `ThemeSnapshot`, and it
 * bites harder here. A frame is composed from the scene, a hit test is answered
 * from the scene, and an invalidation is computed by comparing two scenes. If
 * the scene could change under any of them, a click could be tested against a
 * desktop that was already gone, and the frame that painted would be of a third.
 *
 * Holding a scene therefore means holding one consistent desktop for as long as
 * you hold it, which is exactly what a frame and an input event both need.
 *
 * ## Paint order is computed once
 *
 * Sorting on every access would be the obvious approach and is the wrong one:
 * paint order is read once per frame and per hit test, and the scene changes far
 * less often than either. It is computed when the scene is built and read
 * thereafter.
 */

import type { MonitorId, SurfaceId } from '@devdesk/contracts';

import { contains, type Point, type Rect, union, EMPTY_RECT } from './geometry';
import type { CompositionLayer } from './layer';
import {
  compareSurfaces,
  isPainted,
  takesPointer,
  type CompositionSurface,
} from './surface';

/** An immutable composed desktop. */
export interface CompositionScene {
  /** Every surface, in paint order: bottom first. */
  readonly ordered: readonly CompositionSurface[];
  /** How many surfaces are in the scene, drawn or not. */
  readonly size: number;
  /** The smallest rectangle containing every painted surface. */
  readonly bounds: Rect;

  readonly get: (surfaceId: SurfaceId) => CompositionSurface | undefined;
  readonly has: (surfaceId: SurfaceId) => boolean;
  /** Surfaces in one band, in paint order. */
  readonly inLayer: (layer: CompositionLayer) => readonly CompositionSurface[];
  /** Surfaces on one display, in paint order. */
  readonly onMonitor: (monitorId: MonitorId) => readonly CompositionSurface[];
  /** Surfaces that would actually be drawn, in paint order. */
  readonly painted: () => readonly CompositionSurface[];

  /** Returns a scene with this surface added or replaced. */
  readonly with: (surface: CompositionSurface) => CompositionScene;
  /** Returns a scene without this surface. */
  readonly without: (surfaceId: SurfaceId) => CompositionScene;
  /** Returns a scene built from exactly these surfaces. */
  readonly replaceAll: (surfaces: Iterable<CompositionSurface>) => CompositionScene;
}

function build(entries: ReadonlyMap<SurfaceId, CompositionSurface>): CompositionScene {
  // Computed once, at construction. A scene is read many times per change.
  const ordered = Object.freeze([...entries.values()].sort(compareSurfaces));

  let sceneBounds = EMPTY_RECT;
  for (const surface of ordered) {
    if (isPainted(surface)) sceneBounds = union(sceneBounds, surface.rect);
  }
  const frozenBounds = sceneBounds;

  const scene: CompositionScene = {
    ordered,
    size: entries.size,
    bounds: frozenBounds,

    get: (surfaceId) => entries.get(surfaceId),
    has: (surfaceId) => entries.has(surfaceId),

    inLayer: (layer) => Object.freeze(ordered.filter((surface) => surface.layer === layer)),
    onMonitor: (monitorId) =>
      Object.freeze(ordered.filter((surface) => surface.monitorId === monitorId)),
    painted: () => Object.freeze(ordered.filter(isPainted)),

    with(surface) {
      const next = new Map(entries);
      next.set(surface.surfaceId, surface);
      return build(next);
    },

    without(surfaceId) {
      if (!entries.has(surfaceId)) return scene;
      const next = new Map(entries);
      next.delete(surfaceId);
      return build(next);
    },

    replaceAll(surfaces) {
      const next = new Map<SurfaceId, CompositionSurface>();
      for (const surface of surfaces) next.set(surface.surfaceId, surface);
      return build(next);
    },
  };

  return Object.freeze(scene);
}

/** An empty scene. */
export function createScene(surfaces: Iterable<CompositionSurface> = []): CompositionScene {
  const entries = new Map<SurfaceId, CompositionSurface>();
  for (const surface of surfaces) entries.set(surface.surfaceId, surface);
  return build(entries);
}

/**
 * The surfaces a point falls in, topmost first.
 *
 * Every one of them, not just the first — a caller routing input wants the top
 * interactive one, and a caller deciding what to redraw wants all of them. See
 * {@link hitTest} for the input answer.
 */
export function surfacesAt(scene: CompositionScene, point: Point): readonly CompositionSurface[] {
  const found: CompositionSurface[] = [];

  // Reverse paint order: topmost first, which is the order a caller asking
  // "what is under the cursor" means.
  for (let index = scene.ordered.length - 1; index >= 0; index -= 1) {
    const surface = scene.ordered[index];
    if (surface && isPainted(surface) && contains(surface.rect, point)) found.push(surface);
  }

  return Object.freeze(found);
}

/**
 * The surface a click at this point lands on.
 *
 * Topmost first, skipping anything click-through — which is the whole reason
 * click-through exists: a HUD that is visible and passes clicks lets the desktop
 * underneath be used.
 *
 * Returns `undefined` when nothing takes it, which means the click belongs to
 * whatever is behind the whole desktop rather than to DevDesk.
 */
export function hitTest(scene: CompositionScene, point: Point): CompositionSurface | undefined {
  for (let index = scene.ordered.length - 1; index >= 0; index -= 1) {
    const surface = scene.ordered[index];
    if (surface && takesPointer(surface) && contains(surface.rect, point)) return surface;
  }

  return undefined;
}
