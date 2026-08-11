/**
 * Where the first-party widgets go.
 *
 * ## An arrangement, not a layout engine
 *
 * It answers one question — where does *this* set of widgets sit on *this*
 * display — by stacking them in anchored columns, each widget taking the size
 * its manifest declares. It solves no constraints and persists nothing. Stage 5B
 * owns all of that.
 *
 * The distinction matters because the alternative is hardcoded pixel
 * coordinates, which stop being right the moment the display is not the one
 * they were written against. Anchoring is the smallest thing that is correct on
 * a 1280×800 laptop and a 3840×2160 monitor alike.
 *
 * ## Anchored to the work area, never to the bounds
 *
 * `display_describe` returns the work area — the screen minus the taskbar —
 * because a surface anchored to the bottom of the *bounds* sits underneath it.
 * That distinction is `MonitorDescriptor`'s, carried all the way here.
 *
 * ## Overlap is prevented by construction
 *
 * Widgets in a column are stacked: each one's offset is the sum of the heights
 * and gaps above it, so two can only overlap if a height is wrong. Columns are
 * anchored to opposite edges and {@link assertNoOverlap} checks the result, so
 * a future arrangement that puts two columns close enough to collide fails a
 * test rather than shipping.
 */

import { intersects, rect, type Rect } from '@devdesk/widget-engine';

import type { ShellDisplay } from './displays';

/** Which corner a column hangs from. */
export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** One widget's slot in a column. */
export interface ColumnEntry {
  readonly widgetId: string;
  /** Logical pixels. Comes from the widget's manifest. */
  readonly height: number;
}

/** A stack of widgets anchored to one corner. */
export interface Column {
  readonly anchor: Anchor;
  readonly width: number;
  readonly entries: readonly ColumnEntry[];
}

/** Where one widget ended up. */
export interface ResolvedPlacement {
  readonly widgetId: string;
  readonly rect: Rect;
}

/**
 * The gap between a widget and the screen edge, and between stacked widgets.
 *
 * One number for both, so the desktop reads as a grid rather than as a set of
 * independently placed objects.
 */
export const DESKTOP_MARGIN = 20;

/** Resolves one column against a display's work area, top to bottom. */
export function resolveColumn(display: ShellDisplay, column: Column): readonly ResolvedPlacement[] {
  const area = display.workArea;
  const onLeft = column.anchor === 'top-left' || column.anchor === 'bottom-left';
  const fromTop = column.anchor === 'top-left' || column.anchor === 'top-right';

  const width = Math.min(column.width, Math.max(0, area.width - DESKTOP_MARGIN * 2));
  const x = onLeft
    ? area.x + DESKTOP_MARGIN
    : area.x + area.width - DESKTOP_MARGIN - width;

  // Bottom-anchored columns stack upward, so the entries are walked in reverse
  // and the first one listed still ends up nearest the anchored edge.
  const ordered = fromTop ? column.entries : [...column.entries].reverse();

  const placements: ResolvedPlacement[] = [];
  let offset = DESKTOP_MARGIN;

  for (const entry of ordered) {
    const y = fromTop
      ? area.y + offset
      : area.y + area.height - offset - entry.height;

    placements.push({
      widgetId: entry.widgetId,
      rect: clampToWorkArea(display, rect(x, y, width, entry.height)),
    });
    offset += entry.height + DESKTOP_MARGIN;
  }

  return Object.freeze(fromTop ? placements : placements.reverse());
}

/** Resolves every column. */
export function resolveArrangement(
  display: ShellDisplay,
  columns: readonly Column[],
): readonly ResolvedPlacement[] {
  return Object.freeze(columns.flatMap((column) => resolveColumn(display, column)));
}

/**
 * Clamps a rectangle into the work area.
 *
 * A small display can make a stacked column overhang, and a widget half off the
 * screen is worse than one slightly out of place. Clamping keeps every surface
 * reachable — the property `AC-WGT-2.1` asks for, reached the cheap way until
 * the layout engine reaches it properly.
 */
export function clampToWorkArea(display: ShellDisplay, value: Rect): Rect {
  const area = display.workArea;
  const width = Math.min(value.width, area.width);
  const height = Math.min(value.height, area.height);

  const x = Math.min(Math.max(value.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(value.y, area.y), area.y + area.height - height);

  return rect(x, y, width, height);
}

/**
 * The pairs of placements that overlap.
 *
 * Empty on a correct arrangement. Returned rather than thrown so a caller can
 * decide: a test fails on it, and a runtime that has clamped a column onto a
 * very small display would rather show overlapping widgets than none.
 */
export function findOverlaps(
  placements: readonly ResolvedPlacement[],
): readonly (readonly [string, string])[] {
  const collisions: (readonly [string, string])[] = [];

  for (let a = 0; a < placements.length; a += 1) {
    for (let b = a + 1; b < placements.length; b += 1) {
      const first = placements[a];
      const second = placements[b];
      if (!first || !second) continue;
      if (intersects(first.rect, second.rect)) {
        collisions.push(Object.freeze([first.widgetId, second.widgetId]));
      }
    }
  }

  return Object.freeze(collisions);
}
