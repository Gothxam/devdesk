/**
 * Stage 5A — Desktop Root Component
 *
 * React's job here is deliberately small: take the frame the compositor
 * presented and the views the scheduler reported, and put them on screen.
 * Consumes `@devdesk/effects` glass custom properties (AP-3).
 */

import { parseWidgetInstanceId, type WidgetInstanceId } from '@devdesk/contracts';
import type { CompositionFrame } from '@devdesk/widget-engine';
import { useCallback, useRef, useState } from 'react';

import type { ClockView } from '../widgets/clock/clock';
import type { DesktopController } from './controller';
import { SurfaceCard } from './components/surface-card';
import { Wallpaper } from './components/wallpaper';

export interface HitReadout {
  readonly surfaceId: string | undefined;
  readonly at: { readonly x: number; readonly y: number };
}

export interface DesktopRootProps {
  readonly controller: DesktopController;
  readonly frame: CompositionFrame | undefined;
  readonly views: ReadonlyMap<WidgetInstanceId, ClockView>;
  readonly onHit: (hit: HitReadout) => void;
}

/** The desktop canvas: composed surfaces rendered via SurfaceCard */
export function DesktopRoot(props: DesktopRootProps): React.JSX.Element {
  const canvas = useRef<HTMLDivElement>(null);
  const [hitSurface, setHitSurface] = useState<string | undefined>(undefined);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const bounds = canvas.current?.getBoundingClientRect();
      if (!bounds) return;

      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const hit = props.controller.hitAt(point);

      setHitSurface(hit?.surfaceId);
      props.onHit({ surfaceId: hit?.surfaceId, at: point });
    },
    [props.controller, props.onHit],
  );

  const metrics = props.controller.metrics();

  return (
    <div ref={canvas} onPointerDown={onPointerDown} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <Wallpaper />

      {props.frame?.visible.map((surface) => {
        const instance = parseWidgetInstanceId(surface.surfaceId);
        const isHit = surface.surfaceId === hitSurface;
        const view = instance.ok ? props.views.get(instance.value) : undefined;

        return (
          <SurfaceCard
            key={surface.surfaceId}
            surface={surface}
            isHit={isHit}
            view={view}
            sequence={props.frame?.sequence ?? 0}
            metrics={metrics}
          />
        );
      })}
    </div>
  );
}
