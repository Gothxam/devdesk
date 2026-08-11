/**
 * Stage 6 — Custom Glass Context Menu Component
 * Triggered on right-click on widgets or desktop canvas.
 */

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly instanceId?: string | undefined;
}

export interface ContextMenuProps {
  readonly state: ContextMenuState | null;
  readonly isEditMode: boolean;
  readonly isLocked?: boolean | undefined;
  readonly onClose: () => void;
  readonly onToggleEditMode: () => void;
  readonly onResizeWidget: (instanceId: string, sizePreset: string) => void;
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
            Resize
          </div>
          <button
            type="button"
            className="devdesk-menu-item"
            onClick={() => {
              props.onResizeWidget(instanceId, 'small');
              props.onClose();
            }}
          >
            <span>Small</span>
          </button>
          <button
            type="button"
            className="devdesk-menu-item"
            onClick={() => {
              props.onResizeWidget(instanceId, 'medium');
              props.onClose();
            }}
          >
            <span>Medium / Month</span>
          </button>
          <button
            type="button"
            className="devdesk-menu-item"
            onClick={() => {
              props.onResizeWidget(instanceId, 'large');
              props.onClose();
            }}
          >
            <span>Large / Expanded</span>
          </button>

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
            <span>{props.isLocked ? '🔓 Unlock Position' : '📌 Lock Position'}</span>
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
