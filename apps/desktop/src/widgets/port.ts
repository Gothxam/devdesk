/**
 * The surface port, implemented against the generated IPC contract.
 *
 * This is the only file in the shell that knows both what a widget is and what
 * the core is. `@devdesk/widget-engine` declares the {@link SurfacePort} it
 * needs; this satisfies it by calling commands. The runtime stays testable in
 * Node because it never sees this file.
 *
 * Everything here is a translation: a generated `Result` becomes the runtime's
 * `Result`, and an `IpcError` becomes a {@link SurfacePortError}. No decisions
 * are taken — a port that decided things would be a second place the reveal
 * order is written.
 */

import { commands, type IpcError } from '@devdesk/contracts';
import {
  monitorId,
  surfaceId,
  type SurfaceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';
import type { SurfacePlacement, SurfacePort, SurfacePortError } from '@devdesk/widget-engine';

/**
 * Turns a contract error into a port error.
 *
 * `Internal` deliberately loses nothing here that it had: ERR-1 already stripped
 * the detail on the Rust side, and the trace id is what correlates to the local
 * log. Re-labelling it as "refused" keeps the shell's error handling from
 * needing to know the contract's error taxonomy.
 */
function toPortError(error: IpcError, surface: SurfaceId | undefined): SurfacePortError {
  switch (error.kind) {
    case 'precondition-failed':
      return surface
        ? { kind: 'already-registered', surfaceId: surface }
        : { kind: 'refused', detail: error.detail.reason };
    case 'not-found':
      return surface
        ? { kind: 'not-found', surfaceId: surface }
        : { kind: 'refused', detail: `${error.detail.kind}/${error.detail.id}` };
    case 'internal':
      return { kind: 'refused', detail: `internal error ${error.detail.trace_id}` };
    case 'invalid-argument':
      return { kind: 'refused', detail: `invalid ${error.detail.field}` };
    default:
      return { kind: 'refused', detail: error.kind };
  }
}

/** The port the shell hands the widget runtime. */
export function createTauriSurfacePort(): SurfacePort {
  return Object.freeze({
    async acquire(
      instanceId: WidgetInstanceId,
    ): Promise<Result<SurfacePlacement, SurfacePortError>> {
      // The instance identity *is* the surface identity. Both survive a restart
      // and both name the same thing, so a mapping between them could only ever
      // be wrong.
      const response = await commands.surfaceRegister(instanceId);
      if (response.status === 'error') {
        const branded = surfaceId(instanceId);
        return err(toPortError(response.error, branded.ok ? branded.value : undefined));
      }

      const surface = surfaceId(response.data.surface_id);
      if (!surface.ok) {
        return err({ kind: 'refused', detail: 'the core returned an empty surface identity' });
      }

      // A widget with no display is a real state, not a failure: a closed lid
      // with nothing plugged in.
      const monitor =
        response.data.monitor_id === null ? undefined : monitorId(response.data.monitor_id);

      return ok({
        surfaceId: surface.value,
        monitorId: monitor && monitor.ok ? monitor.value : undefined,
      });
    },

    async reportPainted(surface: SurfaceId): Promise<Result<void, SurfacePortError>> {
      const response = await commands.surfaceReportFirstFrame(surface);
      return response.status === 'ok'
        ? ok(undefined)
        : err(toPortError(response.error, surface));
    },

    async release(surface: SurfaceId): Promise<Result<void, SurfacePortError>> {
      const response = await commands.surfaceRelease(surface);
      return response.status === 'ok'
        ? ok(undefined)
        : err(toPortError(response.error, surface));
    },
  });
}
