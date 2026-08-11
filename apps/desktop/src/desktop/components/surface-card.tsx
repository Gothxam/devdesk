/**
 * Stage 5C — Desktop Mode Surface Card Component
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
    borderRadius: 20,
    overflow: 'hidden',
    ...glass,
    opacity: Number(glass['--surface-opacity']),
    backdropFilter: 'var(--surface-backdrop)',
    background: isOverlay
      ? 'rgba(15, 17, 24, 0.65)'
      : 'rgba(15, 17, 24, 0.82)',
    border: isHit
      ? '1px solid rgba(255, 255, 255, 0.4)'
      : '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: isHit
      ? '0 0 32px rgba(255, 255, 255, 0.18), 0 24px 64px rgba(0, 0, 0, 0.6)'
      : '0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    outline: isHit ? '2px solid rgba(255, 255, 255, 0.45)' : 'none',
    outlineOffset: 2,
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'border-color 0.25s ease, box-shadow 0.25s ease, outline 0.25s ease',
    userSelect: 'none',
  };
}

export function SurfaceCard(props: SurfaceCardProps): React.JSX.Element {
  const { surface, isHit, view, sequence, metrics } = props;
  const instance = parseWidgetInstanceId(surface.surfaceId);

  return (
    <div style={surfaceStyle(surface, isHit)}>
      {view ? (
        /* Native Floating Clock Widget */
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              lineHeight: 1.0,
              color: view.accent,
              fontFamily: "'SF Mono', ui-monospace, Consolas, monospace",
              letterSpacing: '-0.03em',
              textShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
            }}
          >
            {view.time}
          </div>
          <div
            style={{
              fontSize: 13,
              color: view.foreground,
              opacity: 0.85,
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {view.date}
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
            padding: '16px 20px',
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
              padding: '3px 9px',
              borderRadius: 12,
              background: surface.layer === 'overlay' ? 'rgba(239, 68, 68, 0.18)' : 'rgba(255, 255, 255, 0.08)',
              color: surface.layer === 'overlay' ? '#fca5a5' : '#a1a1aa',
              border: '1px solid rgba(255, 255, 255, 0.06)',
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
