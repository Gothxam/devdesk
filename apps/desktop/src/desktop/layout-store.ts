/**
 * Stage 6 — Desktop Layout Storage Adapter
 *
 * `LayoutStorage` interface decouples the UI layer from the persistence mechanism.
 * Current implementation uses `localStorage` (`devdesk_desktop_layout_v1`) as a
 * temporary adapter, allowing future seamless migration to IPC / native DB without
 * changing UI code.
 */

export interface WidgetPlacementRecord {
  readonly instanceId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isLocked: boolean;
  readonly sizePreset: 'small' | 'medium' | 'large' | 'compact' | 'month' | 'expanded' | 'standard' | 'tall';
}

export interface LayoutStorage {
  loadPlacements(workArea: { width: number; height: number }): Map<string, WidgetPlacementRecord>;
  savePlacements(placements: Map<string, WidgetPlacementRecord>): void;
  resetPlacements(workArea: { width: number; height: number }): Map<string, WidgetPlacementRecord>;
}

const STORAGE_KEY = 'devdesk_desktop_layout_v1';

export function createDefaultPlacements(workArea: { width: number; height: number }): Map<string, WidgetPlacementRecord> {
  const margin = 24;
  const colWidth = 300;
  const rightX = Math.max(margin, workArea.width - colWidth - margin);

  const defaults: WidgetPlacementRecord[] = [
    // Clock
    {
      instanceId: 'devdesk.clock#1',
      x: rightX,
      y: margin,
      width: colWidth,
      height: 180,
      isLocked: false,
      sizePreset: 'medium',
    },
    // Calendar
    {
      instanceId: 'devdesk.calendar#1',
      x: rightX,
      y: margin + 180 + 16,
      width: colWidth,
      height: 260,
      isLocked: false,
      sizePreset: 'month',
    },
    // Session
    {
      instanceId: 'devdesk.session#1',
      x: rightX,
      y: margin + 180 + 16 + 260 + 16,
      width: colWidth,
      height: 140,
      isLocked: false,
      sizePreset: 'compact',
    },
    // System
    {
      instanceId: 'devdesk.system#1',
      x: margin,
      y: margin,
      width: colWidth,
      height: 220,
      isLocked: false,
      sizePreset: 'standard',
    },
    // Activity
    {
      instanceId: 'devdesk.activity#1',
      x: margin,
      y: margin + 220 + 16,
      width: colWidth,
      height: 260,
      isLocked: false,
      sizePreset: 'standard',
    },
  ];

  const map = new Map<string, WidgetPlacementRecord>();
  for (const item of defaults) {
    map.set(item.instanceId, item);
  }
  return map;
}

export class LocalStorageAdapter implements LayoutStorage {
  loadPlacements(workArea: { width: number; height: number }): Map<string, WidgetPlacementRecord> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createDefaultPlacements(workArea);
      }
      const records: WidgetPlacementRecord[] = JSON.parse(raw);
      if (!Array.isArray(records) || records.length === 0) {
        return createDefaultPlacements(workArea);
      }

      const map = new Map<string, WidgetPlacementRecord>();
      for (const rec of records) {
        if (rec.instanceId && typeof rec.x === 'number' && typeof rec.y === 'number') {
          map.set(rec.instanceId, rec);
        }
      }
      return map.size > 0 ? map : createDefaultPlacements(workArea);
    } catch {
      return createDefaultPlacements(workArea);
    }
  }

  savePlacements(placements: Map<string, WidgetPlacementRecord>): void {
    try {
      const array = Array.from(placements.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(array));
    } catch {
      // storage unavailable / quota exceeded fallback
    }
  }

  resetPlacements(workArea: { width: number; height: number }): Map<string, WidgetPlacementRecord> {
    const defaults = createDefaultPlacements(workArea);
    this.savePlacements(defaults);
    return defaults;
  }
}

export const layoutStorage: LayoutStorage = new LocalStorageAdapter();
