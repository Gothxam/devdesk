/**
 * Stage 7A — Desktop Surface Card & 100% Dynamic Real-Data Widgets
 *
 * Requirements Met:
 * 1. Clock: Real-time ticker with seconds, system date, no hardcoded strings.
 * 2. Calendar: Dynamic first-weekday calculation, exact days in month (28/29/30/31),
 *    leap year detection, current day highlight, dynamic month/year header.
 * 3. Session Uptime: Continuously updating live uptime since launch.
 * 4. System Telemetry: Strictly uses runtime metrics contract, CPU/Memory rendered as 'Unavailable'.
 * 5. Activity Stream: Actual runtime event/compositor counters.
 */

import { parseWidgetInstanceId } from '@devdesk/contracts';
import { glassStyle } from '@devdesk/effects';
import {
  layerDepth,
  type CompositionSurface,
} from '@devdesk/widget-engine';
import { useEffect, useState, type CSSProperties } from 'react';

import type { ClockView } from '../../widgets/clock/clock';
import type { DesktopMetrics } from '../controller';
import type { WidgetPlacementRecord } from '../layout-store';

/** Calculate calendar grid data dynamically for any date */
export function getCalendarMonthData(now: Date = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  // First weekday of month (0 = Sun, 1 = Mon, ..., 6 = Sat)
  const firstWeekday = new Date(year, month, 1).getDay();

  // Total days in month (passing day 0 of month + 1 returns last day of current month)
  const totalDays = new Date(year, month + 1, 0).getDate();

  const grid: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    grid.push(null);
  }
  for (let d = 1; d <= totalDays; d++) {
    grid.push(d);
  }

  return {
    year,
    month,
    monthName,
    today,
    firstWeekday,
    totalDays,
    grid,
  };
}

/** Format milliseconds into HH:MM:SS uptime string */
export function formatSessionUptime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

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
    transition: 'all var(--devdesk-motion-duration, 0.2s) var(--devdesk-motion-ease, cubic-bezier(0.16, 1, 0.3, 1))',
    userSelect: 'none',
  };
}

/** Render Dynamic Calendar Month Grid */
export function CalendarWidgetGrid(): React.JSX.Element {
  const [currentDate, setCurrentDate] = useState(() => new Date());

  useEffect(() => {
    // Refresh date at midnight
    const timer = setInterval(() => setCurrentDate(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { monthName, today, grid } = getCalendarMonthData(currentDate);
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div style={{ width: '100%', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Month & Year Header */}
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
        {grid.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-cell-${idx}`} />;
          }
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

/** Render Live Session Uptime Timer Widget */
export function SessionWidgetView(): React.JSX.Element {
  const [sessionStart] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - sessionStart);
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStart]);

  const uptimeStr = formatSessionUptime(elapsedMs);

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
        {uptimeStr}
      </div>

      <div style={{ fontSize: 11, opacity: 0.7, display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
        <span>Uptime: {Math.floor(elapsedMs / 1000)}s</span>
        <span>Cadence: 1.0s</span>
      </div>
    </div>
  );
}

/** Render System Telemetry Widget (Strictly uses runtime metrics, CPU/Mem explicitly Unavailable) */
export function SystemWidgetView(props: { readonly metrics: DesktopMetrics | undefined }): React.JSX.Element {
  const wakeups = props.metrics?.wakeups ?? 0;
  const updates = props.metrics?.updates ?? 0;

  return (
    <div style={{ width: '100%', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--devdesk-text)' }}>💻 System Metrics</span>
        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'var(--devdesk-accent-bg)', color: 'var(--devdesk-accent)', fontWeight: 600 }}>
          {wakeups} wakeups
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
            <span>CPU Usage</span>
            <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Unavailable</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
            <div style={{ width: '0%', height: '100%', background: 'var(--devdesk-accent)' }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
            <span>Memory Usage</span>
            <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Unavailable</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
            <div style={{ width: '0%', height: '100%', background: 'var(--devdesk-accent)' }} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.8, marginTop: 2 }}>
          <span>Widget Updates:</span>
          <span style={{ fontWeight: 600, color: 'var(--devdesk-accent)' }}>{updates}</span>
        </div>
      </div>
    </div>
  );
}

/** Render Activity Stream Widget */
export function ActivityWidgetView(props: { readonly sequence: number; readonly layer: string; readonly metrics: DesktopMetrics | undefined }): React.JSX.Element {
  const frames = props.metrics?.frames ?? 0;
  return (
    <div style={{ width: '100%', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--devdesk-text)' }}>📊 Activity Stream</span>
        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'var(--devdesk-accent-bg)', color: 'var(--devdesk-accent)', fontWeight: 600 }}>
          Seq #{props.sequence}
        </span>
      </div>

      <div style={{ fontSize: 11, opacity: 0.75, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Compositor Frames:</span>
          <span style={{ fontWeight: 600, color: 'var(--devdesk-accent)' }}>{frames}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Layer:</span>
          <span style={{ fontWeight: 600, color: '#34d399' }}>{props.layer}</span>
        </div>
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
  const isSystem = instanceKey.includes('system');
  const isActivity = instanceKey.includes('activity');

  // Continuous Clock Ticker state
  const [clockTime, setClockTime] = useState(() => new Date());

  useEffect(() => {
    if (isClock) {
      const timer = setInterval(() => setClockTime(new Date()), 1000);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [isClock]);

  const displayTimeStr = view?.time || clockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const displayDateStr = view?.date || clockTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

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
      {isClock ? (
        /* Dynamic Floating Clock Widget */
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
            {displayTimeStr}
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
            <span>{displayDateStr}</span>
          </div>
        </div>
      ) : isCalendar ? (
        /* Redesigned Dynamic Calendar Widget */
        <CalendarWidgetGrid />
      ) : isSession ? (
        /* Redesigned Session Widget */
        <SessionWidgetView />
      ) : isSystem ? (
        /* Redesigned System Widget */
        <SystemWidgetView metrics={metrics} />
      ) : isActivity ? (
        /* Redesigned Activity Widget */
        <ActivityWidgetView sequence={sequence} layer={surface.layer} metrics={metrics} />
      ) : (
        /* Generic Surface Tile Fallback */
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
