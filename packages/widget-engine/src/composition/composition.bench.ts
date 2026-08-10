/**
 * What composition costs.
 *
 * Two questions:
 *
 * - **Composition overhead** — building scenes, ordering, hit testing,
 *   occlusion. Costs paid on every scene change and every input event.
 * - **Invalidation cost** — comparing scenes and merging the results. The cost
 *   of knowing what to repaint, paid per change; a compositor whose diff is
 *   slower than the paint it saves has the sign of its optimisation wrong.
 *
 * Fleet sizes bracket `ADR-0002`'s W2 workload (24 surfaces): 8 for a light
 * desktop, 32 for above-W2, 128 for a stress shape that should stay sub-frame
 * anyway.
 *
 * Informational under `ADR-0002` `D-2`/`MM-1`: a developer machine, not the
 * §6.1 reference machine, measured by tinybench rather than the §8.5 statistic.
 */

import { monitorId, surfaceId, type SurfaceId } from '@devdesk/contracts';
import { bench, describe } from 'vitest';

import { Compositor } from './compositor';
import { rect } from './geometry';
import { invalidate, mergeInvalidations } from './invalidation';
import { cullOccluded } from './occlusion';
import { createScene, hitTest, surfacesAt } from './scene';
import { createCompositionSurface, type CompositionSurface } from './surface';

function sid(value: string): SurfaceId {
  const parsed = surfaceId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

const LAPTOP = (() => {
  const parsed = monitorId('unit:SN-LAPTOP');
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
})();

/** A grid of surfaces, deterministic and overlapping enough to be honest. */
function fleet(count: number): CompositionSurface[] {
  const surfaces: CompositionSurface[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % 8;
    const row = Math.floor(index / 8);
    surfaces.push(
      createCompositionSurface({
        surfaceId: sid(`surface-${index}`),
        monitorId: LAPTOP,
        // 240×120 tiles with a 40px overlap, so hit tests and occlusion see
        // stacked surfaces rather than a disjoint grid that flatters them.
        rect: rect(column * 200, row * 100, 240, 120),
        layer: index % 5 === 0 ? 'overlay' : 'desktop',
        ordinal: index,
        appearance: index % 7 === 0 ? { opacity: 0.9, blurRadius: 12 } : {},
      }),
    );
  }
  return surfaces;
}

for (const count of [8, 32, 128]) {
  const surfaces = fleet(count);
  const scene = createScene(surfaces);
  const first = surfaces[0];
  if (!first) throw new Error('fixture');

  describe(`composition overhead — ${count} surfaces`, () => {
    bench('build a scene from scratch', () => {
      createScene(surfaces);
    });

    bench('replace one surface in the scene', () => {
      scene.with(
        createCompositionSurface({
          surfaceId: first.surfaceId,
          monitorId: LAPTOP,
          rect: rect(3, 3, 240, 120),
          ordinal: first.ordinal,
        }),
      );
    });

    bench('hit test the centre of the desktop', () => {
      hitTest(scene, { x: 400, y: 200 });
    });

    bench('hit test a miss', () => {
      hitTest(scene, { x: 99_999, y: 99_999 });
    });

    bench('every surface under a point', () => {
      surfacesAt(scene, { x: 400, y: 200 });
    });

    bench('occlusion cull', () => {
      cullOccluded(scene);
    });
  });
}

for (const count of [8, 32, 128]) {
  const before = createScene(fleet(count));

  // One surface moved: the common case during any interaction.
  const oneMoved = before.with(
    createCompositionSurface({
      surfaceId: sid('surface-1'),
      monitorId: LAPTOP,
      rect: rect(500, 500, 240, 120),
      ordinal: 1,
    }),
  );

  // Everything moved: a topology change re-associating a display's surfaces.
  const allMoved = createScene(
    fleet(count).map((surface, index) =>
      createCompositionSurface({
        surfaceId: surface.surfaceId,
        monitorId: LAPTOP,
        rect: rect(surface.rect.x + 7, surface.rect.y + 7, 240, 120),
        layer: surface.layer,
        ordinal: index,
        appearance: surface.appearance,
      }),
    ),
  );

  describe(`invalidation cost — ${count} surfaces`, () => {
    bench('diff two identical scenes', () => {
      // The steady-state answer: what "nothing changed" costs to discover.
      invalidate(before, before);
    });

    bench('diff after one surface moved', () => {
      invalidate(before, oneMoved);
    });

    bench('diff after every surface moved', () => {
      invalidate(before, allMoved);
    });

    const first = invalidate(before, oneMoved);
    const second = invalidate(oneMoved, allMoved);
    bench('merge two invalidations', () => {
      mergeInvalidations(first, second);
    });
  });
}

describe('compositor end to end — 32 surfaces', () => {
  bench('a drag: 10 scene updates, 1 frame', () => {
    let pending: (() => void) | undefined;
    const compositor = new Compositor(
      (callback) => {
        pending = callback;
      },
      () => undefined,
    );

    compositor.update(createScene(fleet(32)));
    pending?.();

    for (let step = 0; step < 10; step += 1) {
      const moved = fleet(32);
      const target = moved[3];
      if (!target) continue;
      compositor.update(
        createScene([
          ...moved.slice(0, 3),
          createCompositionSurface({
            surfaceId: target.surfaceId,
            monitorId: LAPTOP,
            rect: rect(step * 15, step * 9, 240, 120),
            ordinal: target.ordinal,
          }),
          ...moved.slice(4),
        ]),
      );
    }

    pending?.();
  });
});
