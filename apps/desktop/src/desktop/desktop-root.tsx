/**
 * Stage 6 — Desktop Root Component (UI Interaction Layer)
 *
 * Architecture Invariant:
 * `desktop-root.tsx` holds ONLY UI interaction state (`isEditMode`, `editingInstanceId`,
 * `contextMenuState`, `snapGuides`). Widget placements are read from and written to
 * `layoutStorage` (LayoutStorage interface adapter), while `CompositionScene` remains
 * the rendering source of truth.
 */

import {
  invokeDesktopSetEditMode,
  onDesktopEditModeChanged,
  parseWidgetInstanceId,
  readDesktopEditMode,
  type WidgetInstanceId,
} from '@devdesk/contracts';

import type { CompositionFrame } from '@devdesk/widget-engine';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClockView } from '../widgets/clock/clock';
import type { DesktopController } from './controller';
import { ContextMenu, type ContextMenuState } from './components/context-menu';
import { EditOverlay, type SnapGuide } from './components/edit-overlay';
import { SurfaceCard } from './components/surface-card';
import { ThemePicker } from './components/theme-picker';
import { Wallpaper } from './components/wallpaper';
import {
  applyDesktopTheme,
  loadActiveTheme,
  saveActiveTheme,
  subscribeThemeChanges,
  type DesktopThemeConfig,
} from './desktop-theme';

import {
  layoutStorage,
  presetsFor,
  sizeOf,
  type SizePreset,
  type WidgetPlacementRecord,
} from './layout-store';

export interface HitReadout {
  readonly surfaceId: string | undefined;
  readonly at: { readonly x: number; readonly y: number };
}

export interface DesktopRootProps {
  readonly controller: DesktopController;
  readonly frame: CompositionFrame | undefined;
  readonly views: ReadonlyMap<WidgetInstanceId, ClockView>;
  readonly onHit: (hit: HitReadout) => void;
}

export function DesktopRoot(props: DesktopRootProps): React.JSX.Element {
  const canvas = useRef<HTMLDivElement>(null);

  // UI Interaction State ONLY
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editingInstanceId, setEditingInstanceId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [snapGuides, setSnapGuides] = useState<readonly SnapGuide[]>([]);

  // Customizable Theme Engine State
  const [isThemePickerOpen, setIsThemePickerOpen] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<DesktopThemeConfig>(() => loadActiveTheme());

  // Apply CSS Variables to :root on Theme change & subscribe to multi-monitor sync bus
  useEffect(() => {
    applyDesktopTheme(activeTheme);
    const unsubscribe = subscribeThemeChanges((newTheme) => {
      setActiveTheme(newTheme);
    });
    return unsubscribe;
  }, []);


  /**
    * Which display's layout this window owns.
    *
    * Every host window is a separate webview at the **same origin**, so they
    * share one `localStorage`. Without a scope a single key means "whichever
    * monitor saved last": dragging on one screen rewrote the other screen's
    * layout, and the loser adopted coordinates computed for a different size.
    */
  const scope = props.controller.display.monitorId;

  const workArea = useCallback(
    () => ({
      width: typeof window === 'undefined' ? 1920 : window.innerWidth,
      height: typeof window === 'undefined' ? 1080 : window.innerHeight,
    }),
    [],
  );

  const [placements, setPlacements] = useState<Map<string, WidgetPlacementRecord>>(() =>
    layoutStorage.loadPlacements(scope, {
      width: typeof window === 'undefined' ? 1920 : window.innerWidth,
      height: typeof window === 'undefined' ? 1080 : window.innerHeight,
    }),
  );

  /**
   * Adopt the host's mode; never assert our own over it.
   *
   * This used to run `invokeDesktopSetEditMode(isEditMode)` on every change of
   * `isEditMode` — including the mount, where it is `false`. In desktop mode
   * that was the *only* call that ever reached the host, because the button, the
   * context menu and `Ctrl+E` all live in a window that receives no input until
   * edit mode is already on. The logs showed `enabled=false` forever, once per
   * host window per reload, and never once `true`.
   *
   * So the direction is reversed: read the host on mount, then follow it.
   */
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;

    void (async () => {
      const current = await readDesktopEditMode();
      // `undefined` means no host — a browser, where the page is interactive
      // anyway. Keep local state rather than being told "not editing" by a
      // runtime that has no desktop to edit.
      if (live && current !== undefined) setIsEditMode(current);

      const unlisten = await onDesktopEditModeChanged((editing) => {
        if (live) setIsEditMode(editing);
      });

      if (live) stop = unlisten;
      else unlisten?.();
    })();

    return () => {
      live = false;
      stop?.();
    };
  }, []);

  /**
   * Ask the host to change mode.
   *
   * Every in-page trigger goes through here rather than setting state directly,
   * so the host stays the single source of truth and the UI updates when the
   * host confirms. Local state is set too: in a browser there is no host to
   * confirm, and a toggle that did nothing there would be worse than one that
   * is briefly optimistic here.
   */
  const requestEditMode = useCallback((editing: boolean) => {
    setIsEditMode(editing);
    void invokeDesktopSetEditMode(editing);
  }, []);



  // Dragging / Resizing Tracking Refs
  const dragRef = useRef<{
    instanceId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const resizeRef = useRef<{
    instanceId: string;
    startX: number;
    startY: number;
    origWidth: number;
    origHeight: number;
  } | null>(null);

  /**
   * `Ctrl+E` toggles, `Escape` leaves.
   *
   * `Ctrl+E` is the primary shortcut and the one the UI advertises. It reaches
   * the page only while the page has focus, which in desktop mode means only
   * while already editing — so it is how you *leave*, and the system-wide key
   * the host registers is how you get in. Both end at the same command.
   *
   * `Escape` as well as `Ctrl+E`, because edit mode puts a full-screen window in
   * front of everything and the key people press to get out of that is Escape.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const toggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e';
      const leave = event.key === 'Escape';

      if (!toggle && !leave) return;

      event.preventDefault();

      setIsEditMode((previous) => {
        const next = leave ? false : !previous;

        // Escape while not editing is somebody dismissing something else.
        if (next === previous) return previous;

        void invokeDesktopSetEditMode(next);
        return next;
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  // Save placements helper
  const updatePlacement = useCallback((instanceId: string, updater: (prev: WidgetPlacementRecord) => WidgetPlacementRecord) => {
    setPlacements((prev) => {
      const next = new Map(prev);
      const existing = next.get(instanceId) ?? {
        instanceId,
        x: 24,
        y: 24,
        width: 300,
        height: 180,
        isLocked: false,
        sizePreset: 'medium',
      };
      const updated = updater(existing);
      next.set(instanceId, updated);
      layoutStorage.savePlacements(scope, next);
      return next;
    });
  }, [scope]);

  // Drag Start
  const onDragStart = useCallback((instanceId: string, e: React.PointerEvent) => {
    const current = placements.get(instanceId) ?? {
      instanceId,
      x: 24,
      y: 24,
      width: 300,
      height: 180,
      isLocked: false,
      sizePreset: 'medium',
    };
    if (current.isLocked) return;

    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // fallback
    }

    setEditingInstanceId(instanceId);
    dragRef.current = {
      instanceId,
      startX: e.clientX,
      startY: e.clientY,
      origX: current.x,
      origY: current.y,
    };
  }, [placements]);

  // Resize Start
  const onResizeStart = useCallback((instanceId: string, e: React.PointerEvent) => {
    const current = placements.get(instanceId) ?? {
      instanceId,
      x: 24,
      y: 24,
      width: 300,
      height: 180,
      isLocked: false,
      sizePreset: 'medium',
    };
    if (current.isLocked) return;

    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // fallback
    }

    setEditingInstanceId(instanceId);
    resizeRef.current = {
      instanceId,
      startX: e.clientX,
      startY: e.clientY,
      origWidth: current.width,
      origHeight: current.height,
    };
  }, [placements]);

  // Pointer Move (Drag & Resize with 8px Grid & Magnetic Snap Guides)
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current) {
        const { instanceId, startX, startY, origX, origY } = dragRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let rawX = origX + dx;
        let rawY = origY + dy;

        // 8px Grid Snap
        let snappedX = Math.round(rawX / 8) * 8;
        let snappedY = Math.round(rawY / 8) * 8;

        const guides: SnapGuide[] = [];
        const threshold = 8;
        const workWidth = window.innerWidth;

        // Snap to Screen Edges
        if (Math.abs(snappedX - 24) < threshold) {
          snappedX = 24;
          guides.push({ orientation: 'vertical', position: 24 });
        }
        const currentWidth = placements.get(instanceId)?.width ?? 300;
        const rightEdge = workWidth - currentWidth - 24;
        if (Math.abs(snappedX - rightEdge) < threshold) {
          snappedX = rightEdge;
          guides.push({ orientation: 'vertical', position: workWidth - 24 });
        }
        if (Math.abs(snappedY - 24) < threshold) {
          snappedY = 24;
          guides.push({ orientation: 'horizontal', position: 24 });
        }

        setSnapGuides(guides);
        updatePlacement(instanceId, (prev) => ({ ...prev, x: snappedX, y: snappedY }));
      } else if (resizeRef.current) {
        const { instanceId, startX, startY, origWidth, origHeight } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const newW = Math.max(160, Math.round((origWidth + dx) / 8) * 8);
        const newH = Math.max(100, Math.round((origHeight + dy) / 8) * 8);

        updatePlacement(instanceId, (prev) => ({ ...prev, width: newW, height: newH }));
      }
    },
    [placements, updatePlacement],
  );

  // Pointer Up
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    setSnapGuides([]);
  }, []);

  // Context Menu Handler
  const onContextMenu = useCallback((instanceId: string | undefined, e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY, instanceId });
  }, []);

  const metrics = props.controller.metrics();

  return (
    <div
      ref={canvas}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(undefined, e);
      }}
      onClick={() => setContextMenu(null)}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}
    >
      <Wallpaper />

      <EditOverlay
        isEditMode={isEditMode}
        snapGuides={snapGuides}
        workArea={{ width: window.innerWidth, height: window.innerHeight }}
        onToggleEditMode={() => requestEditMode(!isEditMode)}
        onOpenThemePicker={() => setIsThemePickerOpen(true)}
      />

      <ThemePicker
        isOpen={isThemePickerOpen}
        activeTheme={activeTheme}
        onClose={() => setIsThemePickerOpen(false)}
        onApplyTheme={(theme) => {
          setActiveTheme(theme);
          saveActiveTheme(theme);
        }}
      />


      {/* Render Surfaces from Composition Scene (Source of Truth) */}
      {props.frame?.visible.map((surface) => {
        const instance = parseWidgetInstanceId(surface.surfaceId);
        const instanceKey = instance.ok ? instance.value : surface.surfaceId;
        const view = instance.ok ? props.views.get(instance.value) : undefined;

        // Get placement record or fallback
        const placement = placements.get(instanceKey) ?? {
          instanceId: instanceKey,
          x: surface.rect.x,
          y: surface.rect.y,
          width: surface.rect.width,
          height: surface.rect.height,
          isLocked: false,
          sizePreset: 'medium',
        };

        return (
          <SurfaceCard
            key={surface.surfaceId}
            surface={surface}
            placement={placement}
            isEditMode={isEditMode}
            isHit={false}
            view={view}
            sequence={props.frame?.sequence ?? 0}
            metrics={metrics}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
            onContextMenu={(id, e) => onContextMenu(id, e)}
          />
        );
      })}

      {/* Context Menu */}
      <ContextMenu
        state={contextMenu}
        isEditMode={isEditMode}
        presets={contextMenu?.instanceId ? presetsFor(contextMenu.instanceId) : []}
        currentPreset={
          contextMenu?.instanceId ? placements.get(contextMenu.instanceId)?.sizePreset : undefined
        }
        isLocked={contextMenu?.instanceId ? placements.get(contextMenu.instanceId)?.isLocked : false}
        onClose={() => setContextMenu(null)}
        onToggleEditMode={() => requestEditMode(!isEditMode)}
        onResizeWidget={(id, preset) => {
          // One table for the size a preset means, so a size chosen from the
          // menu and a size restored from storage cannot drift apart.
          updatePlacement(id, (prev) => ({ ...prev, sizePreset: preset, ...sizeOf(preset) }));
        }}
        onToggleLock={(id) => {
          updatePlacement(id, (prev) => ({ ...prev, isLocked: !prev.isLocked }));
        }}
        onRemoveWidget={(id) => {
          setPlacements((prev) => {
            const next = new Map(prev);
            next.delete(id);
            layoutStorage.savePlacements(scope, next);
            return next;
          });
        }}
        onResetLayout={() => {
          setPlacements(layoutStorage.resetPlacements(scope, workArea()));
        }}
      />
    </div>
  );
}
