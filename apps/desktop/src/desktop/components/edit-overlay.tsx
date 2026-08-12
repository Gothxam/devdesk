/**
 * Stage 6 — Desktop Overlay, Spacing Grid, Snap Guides & Theme Picker Trigger
 */

export interface SnapGuide {
  readonly orientation: 'vertical' | 'horizontal';
  readonly position: number;
}

export interface EditOverlayProps {
  readonly isEditMode: boolean;
  readonly snapGuides: readonly SnapGuide[];
  readonly workArea: { readonly width: number; readonly height: number };
  readonly onToggleEditMode: () => void;
  readonly onOpenThemePicker?: (() => void) | undefined;
}

export function EditOverlay(props: EditOverlayProps): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 900,
        userSelect: 'none',
      }}
    >
      {/* 8px Spacing Grid Overlay (Visible in Edit Mode) */}
      {props.isEditMode && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(to right, rgba(99, 102, 241, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(99, 102, 241, 0.05) 1px, transparent 1px)',
            backgroundSize: '8px 8px',
          }}
        />
      )}

      {/* Top Floating Hot Buttons / Controls Bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 24,
          zIndex: 1000,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {props.onOpenThemePicker && (
          <button
            type="button"
            onClick={props.onOpenThemePicker}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 20,
              border: '1px solid rgba(255, 255, 255, 0.14)',
              background: 'rgba(18, 20, 28, 0.78)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              transition: 'all 0.2s ease',
            }}
          >
            <span>🎨 Themes</span>
          </button>
        )}

        <button
          type="button"
          onClick={props.onToggleEditMode}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 16px',
            borderRadius: 20,
            border: props.isEditMode
              ? '1px solid rgba(129, 140, 248, 0.6)'
              : '1px solid rgba(255, 255, 255, 0.12)',
            background: props.isEditMode
              ? 'rgba(99, 102, 241, 0.3)'
              : 'rgba(18, 20, 28, 0.75)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            transition: 'all 0.2s ease',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: props.isEditMode ? '#818cf8' : '#10b981',
              boxShadow: props.isEditMode ? '0 0 8px #818cf8' : '0 0 8px #10b981',
            }}
          />
          <span>{props.isEditMode ? '🔒 Done Editing (Ctrl+E)' : '✏️ Edit Layout (Ctrl+E)'}</span>
        </button>
      </div>

      {/* Dynamic Magnetic Snap Alignment Guides */}
      {props.isEditMode &&
        props.snapGuides.map((guide, idx) => (
          <div
            key={`guide-${guide.orientation}-${guide.position}-${idx}`}
            style={{
              position: 'absolute',
              ...(guide.orientation === 'vertical'
                ? {
                    left: guide.position,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: '#06b6d4',
                    boxShadow: '0 0 8px #06b6d4, 0 0 2px #06b6d4',
                  }
                : {
                    top: guide.position,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: '#06b6d4',
                    boxShadow: '0 0 8px #06b6d4, 0 0 2px #06b6d4',
                  }),
            }}
          />
        ))}
    </div>
  );
}
