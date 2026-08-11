/**
 * What the shell knows about displays.
 *
 * Asks the core (`display_describe`), which answers from the real display
 * subsystem — identity-resolved, logical pixels, stable order. In a plain
 * browser (vite dev without Tauri) the command cannot exist, so the shell falls
 * back to **one synthetic display the size of the window** and says so.
 *
 * The fallback is explicitly a degraded dev mode, not a code path Tauri ever
 * takes: its monitor id is unmistakably synthetic, and `isFallback` is carried
 * so the UI can label it rather than quietly pretending the browser window is a
 * monitor.
 *
 * ## Two modes, one answer
 *
 * In **window mode** the shell runs in an ordinary application window and
 * composes on the primary display. In **desktop mode** (`ADR-0005` `DH-13`)
 * there is one host window per monitor, each covering that monitor's full
 * bounds, and the shell in it composes on *its own* monitor. The host window is
 * told which one in its URL; without that, every monitor would lay out against
 * the primary's work area and a second screen would place its widgets off the
 * side.
 *
 * Either way the work area is returned in **viewport coordinates** — relative to
 * the window the shell is running in, which is the space the composed surfaces
 * are positioned in.
 */

import { commands, monitorId, type MonitorId } from '@devdesk/contracts';
import { rect, type Rect } from '@devdesk/widget-engine';

/** One display, as the composed desktop consumes it. */
export interface ShellDisplay {
  readonly monitorId: MonitorId;
  readonly name: string;
  readonly isPrimary: boolean;
  readonly scaleFactor: number;
  /**
   * The placeable area in logical pixels, **relative to this window's viewport**.
   *
   * Not virtual-screen coordinates. A surface at `workArea.x` is that many CSS
   * pixels from the left edge of the window it is drawn in, which is what the
   * composed desktop positions against.
   */
  readonly workArea: Rect;
  /** True when this is the browser-dev stand-in, not a real display. */
  readonly isFallback: boolean;
}

/** The identity the browser fallback uses. Unmistakably not hardware. */
export const FALLBACK_DISPLAY_ID = 'dev:browser-window';

/**
 * The query parameter a desktop host window carries.
 *
 * Set by the Rust host when it creates the window; absent in window mode and in
 * the browser.
 */
export const HOST_MONITOR_PARAM = 'monitor';

function fallbackDisplay(width: number, height: number): ShellDisplay {
  const id = monitorId(FALLBACK_DISPLAY_ID);
  if (!id.ok) throw new Error('the fallback display id must be valid');

  return Object.freeze({
    monitorId: id.value,
    name: 'Browser window (dev fallback)',
    isPrimary: true,
    scaleFactor: 1,
    workArea: rect(0, 0, width, height),
    isFallback: true,
  });
}

/** One display as the core reports it. */
export type ReportedDisplay = Awaited<
  ReturnType<typeof commands.displayDescribe>
> extends infer Response
  ? Response extends { readonly status: 'ok'; readonly data: { readonly monitors: readonly (infer Entry)[] } }
    ? Entry
    : never
  : never;

/** The monitor this window was created for, if it is a desktop host window. */
function hostMonitorId(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  return new URLSearchParams(window.location.search).get(HOST_MONITOR_PARAM) ?? undefined;
}

/**
 * Picks the display to compose on and puts its work area in window coordinates.
 *
 * Separated from the fetch so both modes and every degraded case are testable
 * without a DOM or a Tauri runtime — the fetch below is the one line that has
 * neither.
 *
 * `wanted` is the host window's monitor, or `undefined` in window mode. A host
 * window whose monitor is **no longer in the topology** falls back to the
 * primary rather than to the synthetic display: the window is about to be
 * destroyed by the next topology transaction, and one frame on the wrong real
 * display beats one frame claiming the hardware is a browser.
 */
export function selectDisplay(
  monitors: readonly ReportedDisplay[],
  wanted: string | undefined,
  viewport: { readonly width: number; readonly height: number },
): ShellDisplay {
  const chosen =
    (wanted === undefined ? undefined : monitors.find((entry) => entry.id === wanted)) ??
    monitors.find((entry) => entry.is_primary) ??
    monitors[0];

  if (!chosen) return fallbackDisplay(viewport.width, viewport.height);

  const id = monitorId(chosen.id);
  if (!id.ok) return fallbackDisplay(viewport.width, viewport.height);

  // The viewport's origin. A host window covers the monitor's full bounds, so
  // its top-left *is* `bounds`; a window-mode shell is positioned by the user,
  // and treating the work area as its own origin makes the subtraction the
  // identity — which is what that mode has always assumed.
  const origin = wanted === undefined ? chosen.work_area : chosen.bounds;

  return Object.freeze({
    monitorId: id.value,
    name: chosen.name,
    isPrimary: chosen.is_primary,
    scaleFactor: chosen.scale_factor,
    workArea: rect(
      chosen.work_area.x - origin.x,
      chosen.work_area.y - origin.y,
      chosen.work_area.width,
      chosen.work_area.height,
    ),
    isFallback: false,
  });
}

/**
 * The display the shell composes on.
 *
 * In desktop mode, the monitor this window was created for. Otherwise the
 * primary, or the first attached. Returns the fallback when the command is
 * unreachable (plain browser) or when no display is attached — a closed lid is a
 * real state, and a dev shell with nothing to draw on is not useful to anyone.
 */
export async function fetchPrimaryDisplay(viewport: {
  readonly width: number;
  readonly height: number;
}): Promise<ShellDisplay> {
  try {
    const response = await commands.displayDescribe();
    if (response.status === 'error') return fallbackDisplay(viewport.width, viewport.height);

    return selectDisplay(response.data.monitors, hostMonitorId(), viewport);
  } catch {
    // No Tauri runtime at all. The invoke throws synchronously-ish in a plain
    // browser; either way the answer is the same stand-in.
    return fallbackDisplay(viewport.width, viewport.height);
  }
}
