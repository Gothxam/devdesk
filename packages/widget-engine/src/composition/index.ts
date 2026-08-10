/**
 * The desktop composition layer.
 *
 * ```text
 *  SurfaceManager (core) ─┐
 *  ThemeSnapshot ─────────┼──▶ CompositionScene ──▶ the shell paints
 *  DisplayGraph ──────────┘         │
 *                                   └── hit tests, invalidation, frames
 * ```
 *
 * Sits between the window subsystem and the shell. Given where surfaces are,
 * what band each is in, and what the theme says they should look like, it
 * answers three questions: what order to paint in, what a click lands on, and
 * what actually needs redrawing.
 *
 * ## What it does not do
 *
 * - **It computes no position.** Rectangles arrive from the caller. A compositor
 *   that could decide where a surface goes would be a second layout engine.
 * - **It knows nothing about widgets.** Nothing in this directory imports the
 *   widget runtime. A surface here is an identity, a rectangle, and a band.
 * - **It owns no z-order the user can change.** Bands are `WD-7`/§9.4
 *   architecture; ordering within a band is derived. "Bring to front" and
 *   friends are M1 (`SPRINT_1.md` §8).
 * - **It draws nothing.** Blur and transparency are expressed as intent;
 *   `@devdesk/effects` owns the primitives (§6.2.2).
 */

export {
  type Point,
  type Rect,
  EMPTY_RECT,
  rect,
  isEmpty,
  contains,
  intersects,
  intersection,
  union,
  bounds,
  encloses,
  equalRects,
  area,
} from './geometry';

export {
  type CompositionLayer,
  type LayerGrantError,
  COMPOSITION_LAYERS,
  GRANTABLE_LAYERS,
  DEFAULT_LAYER,
  layerDepth,
  isAbove,
  isGrantable,
  grantLayer,
  describeLayerGrantError,
} from './layer';

export {
  type CompositionSurface,
  type CompositionSurfaceInit,
  type SurfaceAppearance,
  type PointerMode,
  OPAQUE,
  createCompositionSurface,
  withSurface,
  compareSurfaces,
  isPainted,
  takesPointer,
  isOccluding,
  equalSurfaces,
} from './surface';

export {
  type CompositionScene,
  createScene,
  surfacesAt,
  hitTest,
} from './scene';

export {
  type OcclusionResult,
  cullOccluded,
  isOccluded,
} from './occlusion';

export {
  type Invalidation,
  type SurfaceInvalidation,
  type InvalidationReason,
  INVALIDATION_REASONS,
  NO_INVALIDATION,
  invalidate,
  needsRepaint,
  mergeInvalidations,
} from './invalidation';
