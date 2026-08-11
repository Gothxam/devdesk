/**
 * Stage 5C — Refined Desktop Surface Card Component
 * Floating desktop-native widget composition. Zero window chrome.
 * Consumes real widget views & ThemeSnapshot custom properties.
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

export interface SurfaceCardProps {
  readonly surface: CompositionSurface;
  readonly isHit: boolean;
  readonly view: ClockView | undefined;
  readonly sequence: number;
  readonly metrics: DesktopMetrics | undefined;
}

export function surfaceStyle(surface: CompositionSurface, isHit: boolean): CSSProperties {
  const glass = glassStyle(surface.appearance);
  const isOverlay = surface.layer === 'overlay';

  return {
    position: 'absolute',
    left: surface.rect.x,
    top: surface.rect.y,
    width: surface.rect.width,
    height: surface.rect.height,
    zIndex: layerDepth(surface.layer) * 100 + surface.ordinal,
    borderRadius: 24,
    overflow: 'hidden',
    ...glass,
    opacity: Number(glass['--surface-opacity']),
    backdropFilter: 'var(--surface-backdrop, blur(24px) saturate(180%))',
    background: isOverlay
      ? 'rgba(14, 17, 24, 0.65)'
      : 'rgba(14, 17, 24, 0.82)',
    border: isHit
      ? '1px solid rgba(255, 255, 255, 0.5)'
      : '1px solid rgba(255, 255, 255, 0.09)',
    boxShadow: isHit
      ? '0 0 40px rgba(255, 255, 255, 0.22), 0 32px 80px rgba(0, 0, 0, 0.7)'
      : '0 24px 64px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
    outline: isHit ? '2px solid rgba(255, 255, 255, 0.55)' : 'none',
    outlineOffset: 2,
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s ease, box-shadow 0.25s ease, outline 0.25s ease',
    userSelect: 'none',
  };
}

export function SurfaceCard(props: SurfaceCardProps): React.JSX.Element {
  const { surface, isHit, view, sequence, metrics } = props;
  const instance = parseWidgetInstanceId(surface.surfaceId);

  return (
    <div style={surfaceStyle(surface, isHit)} className={`devdesk-surface-card ${isHit ? 'hit' : ''}`}>
      {view ? (
        /* Native Floating Clock Widget */
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          {/* Digital Time Display */}
          <div
            style={{
              fontSize: 54,
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

          {/* Date Badge */}
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

          {!view.hasDisplay && (
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>no display</div>
          )}
        </div>
      ) : (
        /* Native Floating Glass Surface Tile */
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: '20px 24px',
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
              letterSpacing: '0.06em',
              padding: '3px 10px',
              borderRadius: 12,
              background: surface.layer === 'overlay' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              color: surface.layer === 'overlay' ? '#fca5a5' : '#a1a1aa',
              border: '1px solid rgba(255, 255, 255, 0.09)',
            }}
          >
            {surface.layer} Surface
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#e4e4e7',
              fontFamily: "'SF Mono', ui-monospace, Consolas, monospace",
            }}
          >
            #{surface.ordinal} · {surface.pointerMode}
          </div>
        </div>
      )}
    </div>
  );
}
