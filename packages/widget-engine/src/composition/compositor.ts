/**
 * The compositor: scene changes in, frames out.
 *
 * ```text
 *  update(scene) ──▶ invalidate(previous, next) ──▶ accumulate ──▶ frame ──▶ present
 *                                                     │              ▲
 *                                                     └── coalesce ──┘
 * ```
 *
 * ## Frame-aligned, not change-aligned
 *
 * Scene changes arrive whenever they arrive — a drag produces dozens per second,
 * a theme switch produces one, a topology event produces a burst. Painting per
 * change would paint faster than the screen refreshes during a drag and tear
 * during a burst. So changes accumulate, and one frame presents everything that
 * happened since the last one (`AP-1`'s argument, applied to composition).
 *
 * The frame source is declared, not owned: the shell drives composition from
 * `requestAnimationFrame`, a test drives it by hand, and this package — which
 * has no host environment — could not own a frame source if it wanted to. The
 * same shape as `TimerService` and the surface port, for the same reason.
 *
 * ## Dropped frames lose nothing
 *
 * Every invalidation since the last presented frame is merged
 * ({@link mergeInvalidations}), so a surface that moved three times between two
 * paints repaints everywhere it has been. The frame after a stall is bigger,
 * never wrong.
 */

import { type Invalidation, invalidate, mergeInvalidations, needsRepaint, NO_INVALIDATION } from './invalidation';
import { cullOccluded } from './occlusion';
import type { CompositionScene } from './scene';
import { createScene } from './scene';
import type { CompositionSurface } from './surface';

/** Requests one callback before the next frame. The shell supplies RAF. */
export type FrameSource = (callback: () => void) => void;

/** What one presented frame contains. */
export interface CompositionFrame {
  /** A monotonic frame number, for ordering and diagnostics. */
  readonly sequence: number;
  /** The scene this frame presents. */
  readonly scene: CompositionScene;
  /** Everything that changed since the previous presented frame. */
  readonly invalidation: Invalidation;
  /** The surfaces worth drawing, occlusion-culled, in paint order. */
  readonly visible: readonly CompositionSurface[];
}

/** Receives presented frames. The shell paints from this. */
export type FramePresenter = (frame: CompositionFrame) => void;

/** Counters for the benchmark and for diagnostics. */
export interface CompositorMetrics {
  /** Scene updates received. */
  readonly updates: number;
  /** Frames presented. */
  readonly frames: number;
  /** Updates that produced no change and were dropped without a frame. */
  readonly emptyUpdates: number;
  /** Updates that only changed hit testing and were applied without a frame. */
  readonly pointerOnlyUpdates: number;
  /** Frame callbacks requested from the source. */
  readonly frameRequests: number;
}

/**
 * Accumulates scene changes and presents frames.
 *
 * Single-threaded by nature — everything happens on the shell's main thread —
 * so there is no lock, and the invariants are about ordering rather than
 * exclusion: one frame request in flight at a time, and every presented frame's
 * invalidation is exactly the merge of the updates since the previous one.
 */
export class Compositor {
  #scene: CompositionScene = createScene();
  #pending: Invalidation = NO_INVALIDATION;
  #frameRequested = false;
  #sequence = 0;

  readonly #source: FrameSource;
  readonly #presenter: FramePresenter;

  #metrics: CompositorMetrics = {
    updates: 0,
    frames: 0,
    emptyUpdates: 0,
    pointerOnlyUpdates: 0,
    frameRequests: 0,
  };

  constructor(source: FrameSource, presenter: FramePresenter) {
    this.#source = source;
    this.#presenter = presenter;
  }

  get metrics(): CompositorMetrics {
    return Object.freeze({ ...this.#metrics });
  }

  /** The scene as of the last update. What hit tests should run against. */
  get scene(): CompositionScene {
    return this.#scene;
  }

  /** Whether a frame is owed but not yet presented. */
  get hasPendingFrame(): boolean {
    return this.#frameRequested;
  }

  /**
   * Adopts a new scene.
   *
   * Each update is diffed against the one before it, and the diffs **merge**
   * until a frame presents — so what a frame carries is exactly the change
   * since the last presented frame, with a surface that moved three times
   * reporting the whole distance travelled. Diffing per update and merging is
   * equivalent to diffing against the presented scene, and cheaper when most
   * updates arrive with a frame already pending.
   *
   * Hit testing switches to the new scene immediately: input routes against
   * where things are, not where they were last painted. A click during the gap
   * between update and frame should land on the surface the user is about to
   * see — the alternative routes it to a surface that is already gone.
   */
  update(scene: CompositionScene): void {
    this.#metrics = { ...this.#metrics, updates: this.#metrics.updates + 1 };

    const change = invalidate(this.#scene, scene);
    this.#scene = scene;

    if (change.isEmpty) {
      this.#metrics = { ...this.#metrics, emptyUpdates: this.#metrics.emptyUpdates + 1 };
      return;
    }

    this.#pending = mergeInvalidations(this.#pending, change);

    // A change that repaints nothing does not schedule a frame. Pointer-mode
    // changes take effect through `scene` immediately, and waiting for a frame
    // would delay input routing for no pixel's benefit.
    if (!needsRepaint(this.#pending)) {
      this.#metrics = {
        ...this.#metrics,
        pointerOnlyUpdates: this.#metrics.pointerOnlyUpdates + 1,
      };
      return;
    }

    this.requestFrame();
  }

  /**
   * Presents the pending frame now, regardless of the frame source.
   *
   * The escape hatch for tests and for a caller that must not wait — a
   * screenshot, a synchronous resize. Returns what was presented, or `undefined`
   * if nothing was owed.
   */
  flush(): CompositionFrame | undefined {
    if (!needsRepaint(this.#pending)) return undefined;
    return this.present();
  }

  private requestFrame(): void {
    if (this.#frameRequested) return;

    this.#frameRequested = true;
    this.#metrics = { ...this.#metrics, frameRequests: this.#metrics.frameRequests + 1 };

    this.#source(() => {
      // The flag clears before presenting, so an update made *during*
      // presentation schedules the next frame rather than being lost.
      this.#frameRequested = false;
      if (needsRepaint(this.#pending)) this.present();
    });
  }

  private present(): CompositionFrame {
    this.#sequence += 1;

    const frame: CompositionFrame = Object.freeze({
      sequence: this.#sequence,
      scene: this.#scene,
      invalidation: this.#pending,
      visible: cullOccluded(this.#scene).visible,
    });

    this.#pending = NO_INVALIDATION;
    this.#metrics = { ...this.#metrics, frames: this.#metrics.frames + 1 };

    this.#presenter(frame);
    return frame;
  }
}
