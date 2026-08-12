/**
 * Where the desktop layout lives between runs.
 *
 * `LayoutStorage` keeps the UI away from the persistence mechanism, so moving
 * from `localStorage` to the core's own store later changes nothing above this
 * file.
 *
 * ## Why the key carries a monitor
 *
 * Every desktop host window is a separate webview at the **same origin**
 * (`http://tauri.localhost`), so they all share one `localStorage`. A single key
 * therefore does not mean "the layout" — it means "whichever monitor saved
 * last". With two displays attached, dragging a widget on one screen rewrote the
 * other screen's layout, and the loser adopted positions computed for a
 * different size and scale.
 *
 * The monitor id is part of the key. A layout belongs to a display, which is
 * also what makes it survive unplugging one: the arrangement is still there when
 * that display comes back, rather than having been overwritten while it was
 * away.
 */

/** A widget's place on one display. */
export interface WidgetPlacementRecord {
  readonly instanceId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isLocked: boolean;
  readonly sizePreset: SizePreset;
}

/** The named sizes a widget can be set to. */
export type SizePreset =
  | 'small'
  | 'medium'
  | 'large'
  | 'compact'
  | 'month'
  | 'expanded'
  | 'standard'
  | 'tall';

/** The area a layout is computed against. */
export interface WorkArea {
  readonly width: number;
  readonly height: number;
}

export interface LayoutStorage {
  loadPlacements(scope: string, workArea: WorkArea): Map<string, WidgetPlacementRecord>;
  savePlacements(scope: string, placements: Map<string, WidgetPlacementRecord>): void;
  resetPlacements(scope: string, workArea: WorkArea): Map<string, WidgetPlacementRecord>;
}

/**
 * The key prefix. Versioned, so a future shape change can be detected rather
 * than silently mis-parsed into a desktop with everything in the wrong place.
 */
const STORAGE_PREFIX = 'devdesk_desktop_layout_v2';

/**
 * The scope used when no display can be identified.
 *
 * A browser with no host, or a topology that could not be enumerated. Named
 * rather than empty so it is obvious in devtools that this layout belongs to
 * nothing in particular.
 */
export const UNSCOPED = 'unscoped';

/** The `localStorage` key a scope reads and writes. */
export function keyFor(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

/**
 * The size presets a widget kind offers, in the order a menu should show them.
 *
 * Keyed by widget id rather than by instance: two clocks offer the same sizes.
 * A kind that is not listed gets the generic three, which is why adding a widget
 * does not mean editing this table.
 */
const PRESETS_BY_WIDGET: Readonly<Record<string, readonly SizePreset[]>> = {
  'devdesk.clock': ['small', 'medium', 'large'],
  'devdesk.calendar': ['compact', 'month', 'expanded'],
  'devdesk.session': ['compact', 'standard', 'tall'],
  'devdesk.system': ['compact', 'standard', 'tall'],
  'devdesk.activity': ['compact', 'standard', 'tall'],
};

const GENERIC_PRESETS: readonly SizePreset[] = ['small', 'medium', 'large'];

/** The presets offered for a widget instance (`devdesk.clock#1`). */
export function presetsFor(instanceId: string): readonly SizePreset[] {
  const widgetId = instanceId.split('#')[0] ?? instanceId;
  return PRESETS_BY_WIDGET[widgetId] ?? GENERIC_PRESETS;
}

/**
 * The pixel size each preset means.
 *
 * One table, so a preset chosen from the context menu and a preset restored from
 * storage cannot disagree about how big it is.
 */
const PRESET_SIZES: Readonly<Record<SizePreset, { width: number; height: number }>> = {
  small: { width: 240, height: 140 },
  compact: { width: 300, height: 140 },
  medium: { width: 300, height: 180 },
  standard: { width: 300, height: 220 },
  month: { width: 300, height: 260 },
  tall: { width: 300, height: 340 },
  large: { width: 380, height: 260 },
  expanded: { width: 420, height: 340 },
};

/** The size a preset resolves to. */
export function sizeOf(preset: SizePreset): { width: number; height: number } {
  return PRESET_SIZES[preset];
}

/** The layout a display starts with. */
export function createDefaultPlacements(workArea: WorkArea): Map<string, WidgetPlacementRecord> {
  const margin = 24;
  const gap = 16;
  const colWidth = 300;
  const rightX = Math.max(margin, workArea.width - colWidth - margin);

  const right: ReadonlyArray<[string, SizePreset]> = [
    ['devdesk.clock#1', 'medium'],
    ['devdesk.calendar#1', 'month'],
    ['devdesk.session#1', 'compact'],
  ];

  const left: ReadonlyArray<[string, SizePreset]> = [
    ['devdesk.system#1', 'standard'],
    ['devdesk.activity#1', 'standard'],
  ];

  const map = new Map<string, WidgetPlacementRecord>();

  for (const [column, x] of [
    [right, rightX],
    [left, margin],
  ] as const) {
    let y = margin;

    for (const [instanceId, preset] of column) {
      const size = sizeOf(preset);
      map.set(instanceId, { instanceId, x, y, ...size, isLocked: false, sizePreset: preset });
      y += size.height + gap;
    }
  }

  return map;
}

/** Whether a parsed record is usable, rather than merely present. */
function isPlacement(value: unknown): value is WidgetPlacementRecord {
  if (typeof value !== 'object' || value === null) return false;

  const record = value as Partial<WidgetPlacementRecord>;

  return (
    typeof record.instanceId === 'string' &&
    record.instanceId.length > 0 &&
    Number.isFinite(record.x) &&
    Number.isFinite(record.y) &&
    Number.isFinite(record.width) &&
    Number.isFinite(record.height)
  );
}

export class LocalStorageAdapter implements LayoutStorage {
  loadPlacements(scope: string, workArea: WorkArea): Map<string, WidgetPlacementRecord> {
    try {
      const raw = localStorage.getItem(keyFor(scope));
      if (!raw) return createDefaultPlacements(workArea);

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return createDefaultPlacements(workArea);

      const map = new Map<string, WidgetPlacementRecord>();
      for (const record of parsed) {
        // Validated field by field rather than trusted for having an id. A
        // record with a NaN coordinate places a widget nowhere, and it is far
        // harder to diagnose from the screen than from here.
        if (isPlacement(record)) {
          map.set(record.instanceId, {
            ...record,
            isLocked: record.isLocked === true,
            sizePreset: record.sizePreset ?? 'medium',
          });
        }
      }

      // Anything the stored layout does not mention keeps its default place, so
      // a widget added since the layout was saved appears rather than vanishing.
      const defaults = createDefaultPlacements(workArea);
      for (const [instanceId, placement] of defaults) {
        if (!map.has(instanceId)) map.set(instanceId, placement);
      }

      return map;
    } catch {
      return createDefaultPlacements(workArea);
    }
  }

  savePlacements(scope: string, placements: Map<string, WidgetPlacementRecord>): void {
    try {
      localStorage.setItem(keyFor(scope), JSON.stringify(Array.from(placements.values())));
    } catch {
      // Storage unavailable or over quota. The desktop still works for this
      // session; losing the arrangement on restart is worse than a crash only
      // in the sense that the user finds out later.
    }
  }

  resetPlacements(scope: string, workArea: WorkArea): Map<string, WidgetPlacementRecord> {
    const defaults = createDefaultPlacements(workArea);
    this.savePlacements(scope, defaults);
    return defaults;
  }
}

export const layoutStorage: LayoutStorage = new LocalStorageAdapter();
