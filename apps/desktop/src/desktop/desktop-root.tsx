/**
 * The composed desktop, painted in a Threads-inspired reference aesthetic.
 *
 * React's job here is deliberately small: take the frame the compositor
 * presented and the views the scheduler reported, and put them on screen. Every
 * decision — order, visibility, occlusion, glass, hit routing — was already
 * taken by the pipeline, and this file obeys it cleanly.
 *
 * Consumes glass custom properties from `@devdesk/effects` (AP-3).
 */

import { parseWidgetInstanceId, type WidgetInstanceId } from '@devdesk/contracts';
import { glassStyle } from '@devdesk/effects';
import {
  layerDepth,
  type CompositionFrame,
  type CompositionSurface,
} from '@devdesk/widget-engine';
import { useCallback, useRef, useState, type CSSProperties } from 'react';

import type { ClockView } from '../widgets/clock/clock';
import type { DesktopController } from './controller';

/** What the strip shows about the last click. */
export interface HitReadout {
  readonly surfaceId: string | undefined;
  readonly at: { readonly x: number; readonly y: number };
}

function surfaceCardStyle(surface: CompositionSurface, isHit: boolean): CSSProperties {
  const glass = glassStyle(surface.appearance);
  const isOverlay = surface.layer === 'overlay';

  return {
    position: 'absolute',
    left: surface.rect.x,
    top: surface.rect.y,
    width: surface.rect.width,
    height: surface.rect.height,
    // Paint order is the scene's; z-index only mirrors it for the browser.
    zIndex: layerDepth(surface.layer) * 100 + surface.ordinal,
    borderRadius: 16,
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

/** Card Header Bar with Threads-style window controls & layer badges */
function SurfaceCardHeader(props: {
  readonly title: string;
  readonly layer: string;
  readonly pointerMode: string;
  readonly ordinal: number;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(255, 255, 255, 0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff5f56', display: 'inline-block', opacity: 0.8 }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffbd2e', display: 'inline-block', opacity: 0.8 }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#27c93f', display: 'inline-block', opacity: 0.8 }} />
        <span
          style={{
            marginLeft: 8,
            fontSize: 12,
            fontWeight: 600,
            color: '#f3f5f7',
            letterSpacing: '-0.01em',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {props.title}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '2px 6px',
            borderRadius: 4,
            background: props.layer === 'overlay' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
            color: props.layer === 'overlay' ? '#fca5a5' : '#a1a1aa',
          }}
        >
          {props.layer}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#71717a',
          }}
        >
          #{props.ordinal}
        </span>
      </div>
    </div>
  );
}

/** Ordinal 1: System Clock Widget Content */
function ClockFaceContent({ view }: { readonly view: ClockView | undefined }): React.JSX.Element {
  if (!view) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#71717a', fontSize: 13 }}>
        Initializing Clock...
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          lineHeight: 1.0,
          background: 'linear-gradient(180deg, #ffffff 0%, #d4d4d8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '-0.03em',
        }}
      >
        {view.time}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 500,
          color: '#a1a1aa',
        }}
      >
        <span>{view.date}</span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#52525b' }} />
        <span style={{ color: '#10b981', fontWeight: 600 }}>Synced</span>
      </div>
    </div>
  );
}

/** Ordinal 2: Threads AI Agent Decision & Activity Feed */
function AIAgentThreadContent(): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 12,
        overflow: 'hidden',
      }}
    >
      {/* Threads Post Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
          }}
        >
          🤖
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5' }}>Antigravity AI</span>
            <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>✓ Verified Agent</span>
            <span style={{ fontSize: 11, color: '#71717a', marginLeft: 'auto' }}>2m ago</span>
          </div>
          <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>@antigravity_core</div>
        </div>
      </div>

      {/* Post Body */}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.45,
          color: '#e4e4e7',
          fontWeight: 400,
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.04)',
        }}
      >
        Redesigned DevDesk workspace matching Threads reference aesthetic. 3 Sources of Truth & 3 Levels of Abstraction active.
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontWeight: 500 }}>
            #ADR-0004
          </span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 500 }}>
            #Rust-MSVC
          </span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: 'rgba(244, 63, 94, 0.15)', color: '#fb7185', fontWeight: 500 }}>
            #Threads-UI
          </span>
        </div>
      </div>

      {/* Threads Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 4,
          fontSize: 12,
          color: '#71717a',
          fontWeight: 500,
        }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>❤️ 24</span>
          <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>💬 8</span>
          <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>🔁 5</span>
        </div>
        <span style={{ fontSize: 11, color: '#52525b' }}>100% Architecture Compliant</span>
      </div>
    </div>
  );
}

/** Ordinal 3: Performance & Compositor Monitor (Overlay) */
function CompositorOverlayContent({
  sequence,
  isHit,
}: {
  readonly sequence: number;
  readonly isHit: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7' }}>
          ⚡ Compositor Pipeline
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#f87171',
          }}
        >
          Click-Through Layer
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: 8, borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.04)' }}>
          <div style={{ color: '#71717a', fontSize: 10 }}>FRAME SEQUENCE</div>
          <div style={{ color: '#f4f4f5', fontWeight: 600, marginTop: 2 }}>#{sequence}</div>
        </div>
        <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: 8, borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.04)' }}>
          <div style={{ color: '#71717a', fontSize: 10 }}>HIT TEST STATE</div>
          <div style={{ color: isHit ? '#34d399' : '#a1a1aa', fontWeight: 600, marginTop: 2 }}>
            {isHit ? 'ACTIVE TARGET' : 'PASSTHROUGH'}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.3 }}>
        Translucent overlay illustrating AP-3 glass blur compositing & click-through hit testing.
      </div>
    </div>
  );
}

export interface DesktopRootProps {
  readonly controller: DesktopController;
  readonly frame: CompositionFrame | undefined;
  readonly views: ReadonlyMap<WidgetInstanceId, ClockView>;
  readonly onHit: (hit: HitReadout) => void;
}

/** The desktop canvas: composed surfaces in Threads reference aesthetic. */
export function DesktopRoot(props: DesktopRootProps): React.JSX.Element {
  const canvas = useRef<HTMLDivElement>(null);
  const [hitSurface, setHitSurface] = useState<string | undefined>(undefined);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const bounds = canvas.current?.getBoundingClientRect();
      if (!bounds) return;

      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      // The scene answers, not the DOM: click routes through compositor hit test.
      const hit = props.controller.hitAt(point);

      setHitSurface(hit?.surfaceId);
      props.onHit({ surfaceId: hit?.surfaceId, at: point });
    },
    [props.controller, props.onHit],
  );

  return (
    <div
      ref={canvas}
      onPointerDown={onPointerDown}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 0%, #161822 0%, #0a0b0e 65%, #050608 100%)',
        overflow: 'hidden',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Background ambient grid pattern */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />

      {/* Render Composed Surfaces */}
      {props.frame?.visible.map((surface) => {
        const instance = parseWidgetInstanceId(surface.surfaceId);
        const isHit = surface.surfaceId === hitSurface;

        let content: React.JSX.Element;
        let cardTitle = 'Surface';

        if (surface.ordinal === 1) {
          cardTitle = 'System Clock';
          content = <ClockFaceContent view={instance.ok ? props.views.get(instance.value) : undefined} />;
        } else if (surface.ordinal === 2) {
          cardTitle = 'AI Agent Activity Stream';
          content = <AIAgentThreadContent />;
        } else {
          cardTitle = 'Compositor Diagnostic Overlay';
          content = <CompositorOverlayContent sequence={props.frame?.sequence ?? 0} isHit={isHit} />;
        }

        return (
          <div
            key={surface.surfaceId}
            style={surfaceCardStyle(surface, isHit)}
          >
            <SurfaceCardHeader
              title={cardTitle}
              layer={surface.layer}
              pointerMode={surface.pointerMode}
              ordinal={surface.ordinal}
            />
            {content}
          </div>
        );
      })}
    </div>
  );
}
