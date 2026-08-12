/**
 * The menu that replaces the Windows desktop menu.
 *
 * In edit mode a host window is in the overlay band and opaque to input, so a
 * right-click lands here and Explorer never sees it — the shell menu is not
 * suppressed so much as never reached. Out of edit mode the desktop is
 * click-through by design (`DH-16`), and the right-click belongs to Explorer.
 *
 * The page's own default menu is suppressed by `preventDefault` at the canvas,
 * which is what stops WebView2 offering its browser menu on top of this one.
 */

import type { SizePreset } from '../layout-store';

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly instanceId?: string | undefined;
}

export interface ContextMenuProps {
  readonly state: ContextMenuState | null;
  readonly isEditMode: boolean;
  readonly isLocked?: boolean | undefined;
  /**
   * The sizes this widget offers, in the order to show them.
   *
   * Passed in rather than hard-coded, because a calendar's sizes are not a
   * clock's. A menu offering "Large" to a widget that has no large is a menu
   * that lies about what it will do.
   */
  readonly presets: readonly SizePreset[];
  /** Which preset the widget is currently at, so the menu can tick it. */
  readonly currentPreset?: SizePreset | undefined;
  readonly onClose: () => void;
  readonly onToggleEditMode: () => void;
  readonly onResizeWidget: (instanceId: string, sizePreset: SizePreset) => void;
  readonly onToggleLock: (instanceId: string) => void;
  readonly onRemoveWidget: (instanceId: string) => void;
  readonly onResetLayout: () => void;
}

export function ContextMenu(props: ContextMenuProps): React.JSX.Element | null {
  if (!props.state) return null;

  const { x, y, instanceId } = props.state;

  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 2000,
        minWidth: 180,
        borderRadius: 14,
        padding: '6px 0',
        background: 'rgba(18, 20, 28, 0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        color: '#f4f4f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        userSelect: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header if widget specific */}
      {instanceId && (
        <div
          style={{
            padding: '6px 14px 8px 14px',
            fontSize: 11,
            fontWeight: 600,
            color: '#a1a1aa',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: 4,
          }}
        >
          {instanceId}
        </div>
      )}

      {/* Main Options */}
      <button
        type="button"
        className="devdesk-menu-item"
        onClick={() => {
          props.onToggleEditMode();
          props.onClose();
        }}
      >
        <span>{props.isEditMode ? '🔒 Exit Edit Mode' : '✏️ Edit Desktop Layout'}</span>
      </button>

      {instanceId && (
        <>
          <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

          {/* Resize Presets */}
          <div style={{ padding: '4px 14px', fontSize: 11, fontWeight: 600, color: '#71717a' }}>
            Size
          </div>
          {props.presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="devdesk-menu-item"
              disabled={props.isLocked}
              onClick={() => {
                props.onResizeWidget(instanceId, preset);
                props.onClose();
              }}
              style={{
                textTransform: 'capitalize',
                opacity: props.isLocked ? 0.4 : 1,
                cursor: props.isLocked ? 'not-allowed' : 'pointer',
              }}
            >
              <span>{preset}</span>
              {preset === props.currentPreset && <span style={{ marginLeft: 'auto' }}>✓</span>}
            </button>
          ))}

          <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

          {/* Lock / Remove */}
          <button
            type="button"
            className="devdesk-menu-item"
            onClick={() => {
              props.onToggleLock(instanceId);
              props.onClose();
            }}
          >
            <span>{props.isLocked ? '🔓 Unlock' : '📌 Lock Position and Size'}</span>
          </button>
          <button
            type="button"
            className="devdesk-menu-item"
            style={{ color: '#ef4444' }}
            onClick={() => {
              props.onRemoveWidget(instanceId);
              props.onClose();
            }}
          >
            <span>🗑️ Remove Widget</span>
          </button>
        </>
      )}

      <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
      <button
        type="button"
        className="devdesk-menu-item"
        onClick={() => {
          props.onResetLayout();
          props.onClose();
        }}
      >
        <span>🔄 Reset Layout Defaults</span>
      </button>
    </div>
  );
}
