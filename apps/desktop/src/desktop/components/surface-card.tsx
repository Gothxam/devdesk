/**
 * Stage 5A — Surface Card Component
 * Consumes real widget data & ThemeSnapshot values.
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
    borderRadius: 14,
    overflow: 'hidden',
    ...glass,
    opacity: Number(glass['--surface-opacity']),
    backdropFilter: 'var(--surface-backdrop)',
    background: isOverlay
      ? 'rgba(18, 20, 26, 0.65)'
      : 'rgba(18, 20, 26, 0.85)',
    border: isHit
      ? '1px solid rgba(255, 255, 255, 0.35)'
      : '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: isHit
      ? '0 0 24px rgba(255, 255, 255, 0.15), 0 20px 48px rgba(0, 0, 0, 0.6)'
      : '0 16px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
    outline: isHit ? '2px solid rgba(255, 255, 255, 0.4)' : 'none',
    outlineOffset: 2,
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border 0.2s ease, box-shadow 0.2s ease, outline 0.2s ease',
    userSelect: 'none',
  };
}

export function SurfaceCard(props: SurfaceCardProps): React.JSX.Element {
  const { surface, isHit, view, sequence, metrics } = props;
  const instance = parseWidgetInstanceId(surface.surfaceId);

  return (
    <div style={surfaceStyle(surface, isHit)}>
      {/* Card Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff5f56', opacity: 0.8 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffbd2e', opacity: 0.8 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#27c93f', opacity: 0.8 }} />
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#f4f4f5' }}>
            {instance.ok ? `Widget ${instance.value}` : surface.surfaceId}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 5px',
              borderRadius: 4,
              background: surface.layer === 'overlay' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              color: surface.layer === 'overlay' ? '#fca5a5' : '#a1a1aa',
            }}
          >
            {surface.layer}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 500,
              padding: '2px 5px',
              borderRadius: 4,
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#71717a',
            }}
          >
            #{surface.ordinal}
          </span>
        </div>
      </div>

      {/* Card Content: Real Widget View */}
      {view ? (
        <div
          style={{
            flex: 1,
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 42,
              fontWeight: 700,
              lineHeight: 1.0,
              color: view.accent,
              fontFamily: "'SF Mono', ui-monospace, Consolas, monospace",
              letterSpacing: '-0.02em',
            }}
          >
            {view.time}
          </div>
          <div style={{ fontSize: 13, color: view.foreground, opacity: 0.85, fontWeight: 500 }}>
            {view.date}
          </div>
          {!view.hasDisplay && <div style={{ fontSize: 11, color: '#ef4444' }}>no display</div>}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 6,
            fontSize: 11,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
            <span>Pointer Mode:</span>
            <span style={{ color: '#f4f4f5', fontWeight: 600 }}>{surface.pointerMode}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
            <span>Frame Sequence:</span>
            <span style={{ color: '#f4f4f5', fontFamily: 'monospace' }}>#{sequence}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
            <span>Compositor Wakeups:</span>
            <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{metrics?.wakeups ?? 0}</span>
          </div>
        </div>
      )}
    </div>
  );
}
