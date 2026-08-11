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
 */

import { commands, monitorId, type MonitorId } from '@devdesk/contracts';
import { rect, type Rect } from '@devdesk/widget-engine';

/** One display, as the composed desktop consumes it. */
export interface ShellDisplay {
  readonly monitorId: MonitorId;
  readonly name: string;
  readonly isPrimary: boolean;
  readonly scaleFactor: number;
  /** The placeable area in logical pixels. */
  readonly workArea: Rect;
  /** True when this is the browser-dev stand-in, not a real display. */
  readonly isFallback: boolean;
}

/** The identity the browser fallback uses. Unmistakably not hardware. */
export const FALLBACK_DISPLAY_ID = 'dev:browser-window';

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

/**
 * The display the prototype composes on: the primary, or the first attached.
 *
 * Returns the fallback when the command is unreachable (plain browser) or when
 * no display is attached — a closed lid is a real state, and a dev shell with
 * nothing to draw on is not useful to anyone.
 */
export async function fetchPrimaryDisplay(viewport: {
  readonly width: number;
  readonly height: number;
}): Promise<ShellDisplay> {
  try {
    const response = await commands.displayDescribe();
    if (response.status === 'error') return fallbackDisplay(viewport.width, viewport.height);

    const monitors = response.data.monitors;
    const primary = monitors.find((entry) => entry.is_primary) ?? monitors[0];
    if (!primary) return fallbackDisplay(viewport.width, viewport.height);

    const id = monitorId(primary.id);
    if (!id.ok) return fallbackDisplay(viewport.width, viewport.height);

    return Object.freeze({
      monitorId: id.value,
      name: primary.name,
      isPrimary: primary.is_primary,
      scaleFactor: primary.scale_factor,
      workArea: rect(
        primary.work_area.x,
        primary.work_area.y,
        primary.work_area.width,
        primary.work_area.height,
      ),
      isFallback: false,
    });
  } catch {
    // No Tauri runtime at all. The invoke throws synchronously-ish in a plain
    // browser; either way the answer is the same stand-in.
    return fallbackDisplay(viewport.width, viewport.height);
  }
}
