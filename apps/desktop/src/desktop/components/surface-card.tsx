/**
 * Stage 6 — Desktop Surface Card & Redesigned Widgets Component
 *
 * Implements:
 * 1. Desktop Edit Mode UI chrome (bounds, resize handle, lock indicator).
 * 2. Redesigned Widget Views (Clock, Calendar, Session, System/Activity).
 * 3. Drag & Drop interaction hooks.
 */

import { parseWidgetInstanceId } from '@devdesk/contracts';
import { glassStyle } from '@devdesk/effects';
import {
  layerDepth,
  type CompositionFrame,
  type CompositionSurface,
} from '@devdesk/widget-engine';
import type { CSSProperties } from 'react';

import type { ClockView } from '../../widgets/clock/clock';
import type { DesktopController, DesktopMetrics } from '../controller';
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
  const isOverlay = surface.layer === 'overlay';

  return {
    position: 'absolute',
    left: placement.x,
    top: placement.y,
    width: placement.width,
    height: placement.height,
    zIndex: layerDepth(surface.layer) * 100 + surface.ordinal,
    borderRadius: 22,
    overflow: 'hidden',
    ...glass,
    opacity: Number(glass['--surface-opacity']),
    backdropFilter: 'var(--surface-backdrop, blur(24px) saturate(180%))',
    background: isOverlay ? 'rgba(14, 17, 24, 0.65)' : 'rgba(14, 17, 24, 0.82)',
    border: isEditMode
      ? placement.isLocked
        ? '1px dashed rgba(239, 68, 68, 0.6)'
        : '1px solid rgba(129, 140, 248, 0.6)'
      : isHit
      ? '1px solid rgba(255, 255, 255, 0.5)'
      : '1px solid rgba(255, 255, 255, 0.09)',
    boxShadow: isEditMode
      ? '0 0 24px rgba(99, 102, 241, 0.25), 0 24px 64px rgba(0, 0, 0, 0.5)'
      : isHit
      ? '0 0 40px rgba(255, 255, 255, 0.22), 0 32px 80px rgba(0, 0, 0, 0.7)'
      : '0 24px 64px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
    pointerEvents: 'auto',
    cursor: isEditMode ? (placement.isLocked ? 'not-allowed' : 'grab') : 'pointer',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    transition: isEditMode ? 'border-color 0.15s ease, box-shadow 0.15s ease' : 'transform 0.25s ease, border-color 0.25s ease',
    userSelect: 'none',
  };
}

/** Render Calendar Month Grid */
function CalendarWidgetGrid(): React.JSX.Element {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date().getDate();
  const monthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  // Generate 31 days calendar grid
  const gridCells = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div style={{ width: '100%', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Month Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#f4f4f5', fontWeight: 700, fontSize: 13 }}>
        <span>{monthName}</span>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8' }}>
          Today: {today}
        </span>
      </div>

      {/* Weekday Header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#71717a' }}>
        {days.map((d, i) => (
          <div key={`day-hdr-${i}`}>{d}</div>
        ))}
      </div>

      {/* Days Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, textAlign: 'center', fontSize: 11, fontWeight: 500, color: '#a1a1aa' }}>
        {gridCells.slice(0, 28).map((day) => {
          const isToday = day === today;
          return (
            <div
              key={`day-cell-${day}`}
              style={{
                padding: '3px 0',
                borderRadius: 6,
                background: isToday ? '#6366f1' : 'transparent',
                color: isToday ? '#ffffff' : '#a1a1aa',
                fontWeight: isToday ? 700 : 500,
                boxShadow: isToday ? '0 2px 8px rgba(99, 102, 241, 0.5)' : 'none',
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
    <div style={{ width: '100%', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="devdesk-live-dot" />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#f4f4f5' }}>Session Uptime</span>
        </div>
        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 600 }}>
          Active
        </span>
      </div>

      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'SF Mono', monospace", color: '#38bdf8', letterSpacing: '-0.02em' }}>
        00:45:12
      </div>

      <div style={{ fontSize: 11, color: '#71717a', display: 'flex', justifyContent: 'space-between' }}>
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
      className={`devdesk-surface-card ${isHit ? 'hit' : ''}`}
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
            top: 8,
            left: 12,
            right: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 10,
            fontSize: 10,
            fontWeight: 600,
            color: placement.isLocked ? '#fca5a5' : '#818cf8',
            pointerEvents: 'none',
          }}
        >
          <span>{placement.isLocked ? '🔒 Locked' : '⋮⋮ Drag'}</span>
          <span>{placement.sizePreset}</span>
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
              fontSize: placement.sizePreset === 'large' ? 60 : placement.sizePreset === 'small' ? 36 : 48,
              fontWeight: 700,
              lineHeight: 1.0,
              color: view.accent,
              fontFamily: "'SF Mono', ui-monospace, Consolas, monospace",
              letterSpacing: '-0.03em',
              textShadow: '0 4px 28px rgba(0, 0, 0, 0.55)',
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
              fontWeight: 500,
              padding: '4px 14px',
              borderRadius: 16,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              color: view.foreground,
              backdropFilter: 'blur(10px)',
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
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '3px 10px',
              borderRadius: 12,
              background: surface.layer === 'overlay' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              color: surface.layer === 'overlay' ? '#fca5a5' : '#a1a1aa',
              border: '1px solid rgba(255, 255, 255, 0.09)',
            }}
          >
            {instanceKey}
          </div>
          <div style={{ fontSize: 11, color: '#a1a1aa', fontFamily: "'SF Mono', monospace" }}>
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
