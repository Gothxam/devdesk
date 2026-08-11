/**
 * A surface port for the composed desktop.
 *
 * ## The checkpoint's one deliberate deviation, stated plainly
 *
 * The core's model is one OS window per surface (`devdesk-core`'s window
 * subsystem, tested and untouched). This prototype composes every surface
 * **inside the shell's own window** instead: a surface is a region the
 * compositor places, not a window the OS places. So the port that "acquires a
 * surface" allocates in-process rather than calling `surface_register`.
 *
 * Why: the composition layer is the thing this checkpoint exists to see
 * working, and it models exactly this — one scene, painted by the shell, with
 * z-order, hit-testing, and glass. Driving per-surface OS windows from it is
 * real work (per-window webviews, per-window theme propagation) that belongs
 * with the layout engine, not with a checkpoint.
 *
 * The Tauri port (`./port.ts`) remains the real-window implementation. Both
 * satisfy the same `SurfacePort`, which is the point of the port existing.
 *
 * ## Reveal discipline is kept
 *
 * A composed surface is still not *shown* until `reportPainted`: the desktop
 * root renders only surfaces the scene marks visible, and the controller flips
 * visibility on exactly that call. The no-flash rule survives the deviation.
 */

import {
  surfaceId,
  type MonitorId,
  type SurfaceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';
import type { SurfacePlacement, SurfacePort, SurfacePortError } from '@devdesk/widget-engine';

/** The composed port, plus what the desktop needs to observe about it. */
export interface ComposedSurfacePort extends SurfacePort {
  /** Surfaces currently alive, in acquisition order. */
  readonly live: () => readonly SurfaceId[];
  /** Surfaces that have reported a first paint. */
  readonly painted: () => readonly SurfaceId[];
}

/**
 * Creates the in-process port.
 *
 * The monitor is supplied once: the prototype composes on one display, and
 * which one is the caller's decision, made from real topology where there is
 * one.
 */
export function createComposedPort(monitor: MonitorId | undefined): ComposedSurfacePort {
  const live = new Set<SurfaceId>();
  const painted = new Set<SurfaceId>();

  return Object.freeze({
    async acquire(
      instanceId: WidgetInstanceId,
    ): Promise<Result<SurfacePlacement, SurfacePortError>> {
      // The instance identity is the surface identity, same as the real core.
      const surface = surfaceId(instanceId);
      if (!surface.ok) {
        return err({ kind: 'refused', detail: 'an instance identity must be a surface identity' });
      }

      if (live.has(surface.value)) {
        return err({ kind: 'already-registered', surfaceId: surface.value });
      }

      live.add(surface.value);
      return ok({ surfaceId: surface.value, monitorId: monitor });
    },

    async reportPainted(surface: SurfaceId): Promise<Result<void, SurfacePortError>> {
      if (!live.has(surface)) return err({ kind: 'not-found', surfaceId: surface });
      painted.add(surface);
      return ok(undefined);
    },

    async release(surface: SurfaceId): Promise<Result<void, SurfacePortError>> {
      if (!live.has(surface)) return err({ kind: 'not-found', surfaceId: surface });
      live.delete(surface);
      painted.delete(surface);
      return ok(undefined);
    },

    live: () => Object.freeze([...live]),
    painted: () => Object.freeze([...painted]),
  });
}
