/**
 * Stage 6 — Desktop Edit Mode Overlay & Snap Alignment Guides
 * Renders 8px spacing grid and magnetic cyan alignment guides when Edit Mode is active.
 */

export interface SnapGuide {
  readonly orientation: 'vertical' | 'horizontal';
  readonly position: number;
}

export interface EditOverlayProps {
  readonly isEditMode: boolean;
  readonly snapGuides: readonly SnapGuide[];
  readonly workArea: { readonly width: number; readonly height: number };
}

export function EditOverlay(props: EditOverlayProps): React.JSX.Element | null {
  if (!props.isEditMode) return null;

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
      {/* 8px Spacing Grid Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(to right, rgba(99, 102, 241, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(99, 102, 241, 0.04) 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      />

      {/* Edit Mode Active Banner */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 16px',
          borderRadius: 20,
          background: 'rgba(99, 102, 241, 0.25)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(129, 140, 248, 0.4)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />
        <span>Desktop Edit Mode Active — Drag to reposition · Corner handles to resize</span>
      </div>

      {/* Dynamic Magnetic Snap Alignment Guides */}
      {props.snapGuides.map((guide, idx) => (
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
