/**
 * The composed desktop, painted.
 *
 * React's job here is deliberately small: take the frame the compositor
 * presented and the views the scheduler reported, and put them on screen. Every
 * decision — order, visibility, occlusion, glass, hit routing — was already
 * taken by the pipeline, and this file just obeys it.
 *
 * Styles are set through the `style` prop (CSSOM), which the CSP permits;
 * inline `<style>` markup would not be. The glass custom properties come from
 * `@devdesk/effects` — `AP-3`: this file consumes `var(--surface-backdrop)`,
 * it never writes a `backdrop-filter` value of its own.
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

function surfaceStyle(surface: CompositionSurface, isHit: boolean): CSSProperties {
  const glass = glassStyle(surface.appearance);

  return {
    position: 'absolute',
    left: surface.rect.x,
    top: surface.rect.y,
    width: surface.rect.width,
    height: surface.rect.height,
    // Paint order is the scene's; z-index only mirrors it for the browser.
    zIndex: layerDepth(surface.layer) * 100 + surface.ordinal,
    borderRadius: 12,
    overflow: 'hidden',
    // Consuming the effects package's custom properties, never writing our own
    // backdrop-filter (AP-3).
    ...glass,
    opacity: Number(glass['--surface-opacity']),
    backdropFilter: 'var(--surface-backdrop)',
    background: 'var(--surface-tint)',
    outline: isHit ? '2px solid var(--color-accent, #7aa2ff)' : 'none',
    outlineOffset: 2,
    // The scene decides hit routing; the DOM must not intercept what the scene
    // says passes through.
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  };
}

function ClockFace({ view }: { readonly view: ClockView | undefined }): React.JSX.Element {
  if (!view) return <div />;

  return (
    <div style={{ textAlign: 'center', color: view.foreground, userSelect: 'none' }}>
      <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.1, color: view.accent }}>
        {view.time}
      </div>
      <div style={{ fontSize: 14, opacity: 0.8 }}>{view.date}</div>
      {!view.hasDisplay && <div style={{ fontSize: 11 }}>no display</div>}
    </div>
  );
}

export interface DesktopRootProps {
  readonly controller: DesktopController;
  readonly frame: CompositionFrame | undefined;
  readonly views: ReadonlyMap<WidgetInstanceId, ClockView>;
  readonly onHit: (hit: HitReadout) => void;
}

/** The desktop canvas: composed surfaces, hit-tested through the scene. */
export function DesktopRoot(props: DesktopRootProps): React.JSX.Element {
  const canvas = useRef<HTMLDivElement>(null);
  const [hitSurface, setHitSurface] = useState<string | undefined>(undefined);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const bounds = canvas.current?.getBoundingClientRect();
      if (!bounds) return;

      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      // The scene answers, not the DOM: surfaces are pointer-events none, so
      // every click lands here and routes through the compositor's hit test —
      // which is what makes click-through observable.
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
        background: 'var(--color-canvas, #101216)',
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {props.frame?.visible.map((surface) => {
        // A composed surface's identity is its widget instance's identity, by
        // the same rule the real core uses. Recovered by parsing rather than
        // cast, so a surface that is not a widget simply renders empty.
        const instance = parseWidgetInstanceId(surface.surfaceId);
        return (
          <div
            key={surface.surfaceId}
            style={surfaceStyle(surface, surface.surfaceId === hitSurface)}
          >
            <ClockFace view={instance.ok ? props.views.get(instance.value) : undefined} />
          </div>
        );
      })}
    </div>
  );
}
