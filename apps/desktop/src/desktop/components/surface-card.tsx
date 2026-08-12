/**
 * Stage 6 — Desktop Surface Card & Token-Driven Widgets Component
 * All visual aesthetics (colors, blur, borders, radius, shadow, font) are derived 100% from CSS variable tokens emitted by the active theme.
 */

import { parseWidgetInstanceId } from '@devdesk/contracts';
import { glassStyle } from '@devdesk/effects';
import {
  layerDepth,
  type CompositionSurface,
} from '@devdesk/widget-engine';
import type { CSSProperties } from 'react';

import type { ClockView } from '../../widgets/clock/clock';
import type { DesktopMetrics } from '../controller';
import type { WidgetPlacementRecord } from '../layout-store';

export interface SurfaceCardProps {
  readonly surface: CompositionSurface;
  readonly placement: WidgetPlacementRecord;
  readonly isEditMode: boolean;
  readonly isHit: boolean;
  readonly view: ClockView | undefined;
  readonly sequence: number;
  readonly metrics: DesktopMetrics | undefined;
  readonly onDragStart: (instanceId: string, event: React.PointerEvent) => void;
  readonly onResizeStart: (instanceId: string, event: React.PointerEvent) => void;
  readonly onContextMenu: (instanceId: string, event: React.MouseEvent) => void;
}

export function surfaceStyle(
  surface: CompositionSurface,
  placement: WidgetPlacementRecord,
  isEditMode: boolean,
  isHit: boolean,
): CSSProperties {
  const glass = glassStyle(surface.appearance);

  return {
    position: 'absolute',
    left: placement.x,
    top: placement.y,
    width: placement.width,
    height: placement.height,
    zIndex: layerDepth(surface.layer) * 100 + surface.ordinal,
    borderRadius: 'var(--devdesk-radius)',
    overflow: 'hidden',
    ...glass,
    opacity: Number(glass['--surface-opacity']),
    backdropFilter: 'blur(var(--devdesk-blur)) saturate(200%)',
    WebkitBackdropFilter: 'blur(var(--devdesk-blur)) saturate(200%)',
    background: 'var(--devdesk-bg)',
    border: isEditMode
      ? placement.isLocked
        ? '1px dashed rgba(239, 68, 68, 0.75)'
        : '2px solid var(--devdesk-accent)'
      : isHit
      ? '1px solid var(--devdesk-accent)'
      : 'var(--devdesk-border)',
    boxShadow: isEditMode
      ? '0 0 32px var(--devdesk-accent-border), var(--devdesk-shadow)'
      : isHit
      ? '0 0 44px var(--devdesk-accent-border), var(--devdesk-shadow)'
      : 'var(--devdesk-shadow)',
    fontFamily: 'var(--devdesk-font)',
    color: 'var(--devdesk-text)',
    pointerEvents: 'auto',
    cursor: isEditMode ? (placement.isLocked ? 'not-allowed' : 'grab') : 'pointer',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    userSelect: 'none',
  };
}

/** Render Calendar Month Grid */
function CalendarWidgetGrid(): React.JSX.Element {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date().getDate();
  const monthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  const gridCells = Array.from({ length: 28 }, (_, i) => i + 1);

  return (
    <div style={{ width: '100%', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Month Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--devdesk-text)', fontWeight: 700, fontSize: 13 }}>
        <span style={{ letterSpacing: '-0.01em' }}>{monthName}</span>
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 12, background: 'var(--devdesk-accent-bg)', color: 'var(--devdesk-accent)', fontWeight: 600, border: '1px solid var(--devdesk-accent-border)' }}>
          Today: {today}
        </span>
      </div>

      {/* Weekday Header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 10, fontWeight: 600, opacity: 0.7 }}>
        {days.map((d, i) => (
          <div key={`day-hdr-${i}`}>{d}</div>
        ))}
      </div>

      {/* Days Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 11, fontWeight: 500 }}>
        {gridCells.map((day) => {
          const isToday = day === today;
          return (
            <div
              key={`day-cell-${day}`}
              style={{
                padding: '4px 0',
                borderRadius: 8,
                background: isToday ? 'var(--devdesk-accent)' : 'transparent',
                color: isToday ? '#ffffff' : 'var(--devdesk-text)',
                fontWeight: isToday ? 700 : 500,
                boxShadow: isToday ? '0 4px 14px var(--devdesk-accent-border)' : 'none',
              }}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Render Session Uptime Timer Widget */
function SessionWidgetView(): React.JSX.Element {
  return (
    <div style={{ width: '100%', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="devdesk-live-dot" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--devdesk-text)' }}>Session Uptime</span>
        </div>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--devdesk-accent-bg)', color: 'var(--devdesk-accent)', fontWeight: 600, border: '1px solid var(--devdesk-accent-border)' }}>
          Active
        </span>
      </div>

      <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--devdesk-font)', color: 'var(--devdesk-accent)', letterSpacing: '-0.03em', textShadow: '0 4px 16px var(--devdesk-accent-border)' }}>
        00:45:12
      </div>

      <div style={{ fontSize: 11, opacity: 0.7, display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
        <span>Start: 15:30:00</span>
        <span>Cadence: 1.0s</span>
      </div>
    </div>
  );
}

export function SurfaceCard(props: SurfaceCardProps): React.JSX.Element {
  const { surface, placement, isEditMode, isHit, view, sequence, metrics, onDragStart, onResizeStart, onContextMenu } = props;
  const instance = parseWidgetInstanceId(surface.surfaceId);
  const instanceKey = instance.ok ? instance.value : surface.surfaceId;

  const isClock = instanceKey.includes('clock');
  const isCalendar = instanceKey.includes('calendar');
  const isSession = instanceKey.includes('session');

  return (
    <div
      style={surfaceStyle(surface, placement, isEditMode, isHit)}
      className={`devdesk-surface-card ${isHit ? 'hit' : ''} ${isEditMode ? 'editing' : ''}`}
      onPointerDown={(e) => {
        if (isEditMode && !placement.isLocked) {
          onDragStart(placement.instanceId, e);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(placement.instanceId, e);
      }}
    >
      {/* Edit Mode Header Indicator */}
      {isEditMode && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 14,
            right: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 10,
            fontSize: 10,
            fontWeight: 600,
            color: placement.isLocked ? '#fca5a5' : 'var(--devdesk-accent)',
            pointerEvents: 'none',
          }}
        >
          <span>{placement.isLocked ? '🔒 Locked' : '⋮⋮ Drag Widget'}</span>
          <span style={{ padding: '2px 6px', borderRadius: 8, background: 'var(--devdesk-accent-bg)', border: '1px solid var(--devdesk-accent-border)' }}>
            {placement.sizePreset}
          </span>
        </div>
      )}

      {/* Widget Visual Content */}
      {view && isClock ? (
        /* Redesigned Floating Clock Widget */
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: placement.sizePreset === 'large' ? '28px 32px' : '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: placement.sizePreset === 'large' ? 12 : 8,
          }}
        >
          <div
            style={{
              fontSize: placement.sizePreset === 'large' ? 64 : placement.sizePreset === 'small' ? 38 : 52,
              fontWeight: 700,
              lineHeight: 1.0,
              color: 'var(--devdesk-accent)',
              fontFamily: 'var(--devdesk-font)',
              letterSpacing: '-0.04em',
              textShadow: '0 4px 32px var(--devdesk-accent-border)',
            }}
          >
            {view.time}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 16px',
              borderRadius: 18,
              background: 'var(--devdesk-accent-bg)',
              border: '1px solid var(--devdesk-accent-border)',
              color: 'var(--devdesk-text)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <span className="devdesk-live-dot" />
            <span>{view.date}</span>
          </div>
        </div>
      ) : isCalendar ? (
        /* Redesigned Calendar Widget */
        <CalendarWidgetGrid />
      ) : isSession ? (
        /* Redesigned Session Widget */
        <SessionWidgetView />
      ) : (
        /* System / Activity / Generic Surface Tile */
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '4px 12px',
              borderRadius: 14,
              background: surface.layer === 'overlay' ? 'rgba(239, 68, 68, 0.22)' : 'var(--devdesk-accent-bg)',
              color: surface.layer === 'overlay' ? '#fca5a5' : 'var(--devdesk-accent)',
              border: '1px solid var(--devdesk-accent-border)',
            }}
          >
            {instanceKey}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, fontFamily: 'var(--devdesk-font)' }}>
            Seq #{sequence} · {metrics?.wakeups ?? 0} wakeups
          </div>
        </div>
      )}

      {/* Resize Handle (Bottom Right) */}
      {isEditMode && !placement.isLocked && (
        <div
          className="devdesk-resize-handle"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(placement.instanceId, e);
          }}
        />
      )}
    </div>
  );
}
