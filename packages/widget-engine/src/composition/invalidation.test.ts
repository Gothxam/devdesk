import { monitorId, surfaceId, type SurfaceId } from '@devdesk/contracts';
import { describe, expect, it } from 'vitest';

import { EMPTY_RECT, rect } from './geometry';
import {
  invalidate,
  mergeInvalidations,
  needsRepaint,
  NO_INVALIDATION,
  type Invalidation,
} from './invalidation';
import { cullOccluded, isOccluded } from './occlusion';
import { createScene } from './scene';
import { createCompositionSurface, withSurface } from './surface';

function sid(value: string): SurfaceId {
  const parsed = surfaceId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function mid(value: string) {
  const parsed = monitorId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

const LAPTOP = mid('unit:SN-LAPTOP');

function surface(name: string, overrides: object = {}) {
  return createCompositionSurface({
    surfaceId: sid(name),
    monitorId: LAPTOP,
    rect: rect(0, 0, 100, 100),
    ...overrides,
  });
}

function reasonsOf(invalidation: Invalidation, name: string): readonly string[] {
  return invalidation.surfaces.find((entry) => entry.surfaceId === name)?.reasons ?? [];
}

// ------------------------------------------------------------ invalidation --

describe('invalidate', () => {
  it('reports nothing for two identical scenes', () => {
    const scene = createScene([surface('a'), surface('b')]);
    const nothing = invalidate(scene, scene);

    expect(nothing.isEmpty).toBe(true);
    expect(nothing).toBe(NO_INVALIDATION);
    expect(needsRepaint(nothing)).toBe(false);
  });

  it('reports nothing when a scene is rebuilt with equal surfaces', () => {
    // Compared by composited result, not object identity. Rebuilding the scene
    // from equal values must not repaint the desktop.
    const before = createScene([surface('a')]);
    const after = createScene([surface('a')]);

    expect(invalidate(before, after).isEmpty).toBe(true);
  });

  it('reports an added surface and damages where it is', () => {
    const before = createScene();
    const after = createScene([surface('a', { rect: rect(10, 10, 50, 50) })]);
    const change = invalidate(before, after);

    expect(reasonsOf(change, 'a')).toEqual(['added']);
    expect(change.damage).toEqual(rect(10, 10, 50, 50));
    expect(change.reordered).toBe(true);
  });

  it('reports a removed surface and damages where it was', () => {
    const before = createScene([surface('a', { rect: rect(10, 10, 50, 50) })]);
    const change = invalidate(before, createScene());

    expect(reasonsOf(change, 'a')).toEqual(['removed']);
    expect(change.damage).toEqual(rect(10, 10, 50, 50));
  });

  it('damages both rectangles when a surface moves', () => {
    // One to erase where it was, one to draw where it is.
    const before = createScene([surface('a', { rect: rect(0, 0, 10, 10) })]);
    const after = createScene([surface('a', { rect: rect(90, 90, 10, 10) })]);
    const change = invalidate(before, after);

    expect(reasonsOf(change, 'a')).toEqual(['moved']);
    expect(change.damage).toEqual(rect(0, 0, 100, 100));
    expect(change.reordered).toBe(false);
  });

  it('reports a resize as a move', () => {
    const before = createScene([surface('a', { rect: rect(0, 0, 10, 10) })]);
    const after = createScene([surface('a', { rect: rect(0, 0, 20, 20) })]);

    expect(reasonsOf(invalidate(before, after), 'a')).toEqual(['moved']);
  });

  it('reports every reason a surface changed for', () => {
    const before = createScene([surface('a')]);
    const after = createScene([
      surface('a', {
        rect: rect(5, 5, 100, 100),
        layer: 'overlay',
        appearance: { opacity: 0.5 },
        pointerMode: 'click-through',
      }),
    ]);

    expect(reasonsOf(invalidate(before, after), 'a')).toEqual([
      'moved',
      'appearance',
      'layer',
      'pointer',
    ]);
  });

  it('damages nothing for a surface that was and stays unpainted', () => {
    const before = createScene([surface('a', { isVisible: false, rect: rect(0, 0, 50, 50) })]);
    const after = createScene([
      surface('a', { isVisible: false, rect: rect(500, 500, 50, 50) }),
    ]);
    const change = invalidate(before, after);

    expect(reasonsOf(change, 'a')).toEqual(['moved']);
    expect(change.damage).toEqual(EMPTY_RECT);
    expect(needsRepaint(change)).toBe(false);
  });

  it('damages where a surface was when it becomes invisible', () => {
    const before = createScene([surface('a', { rect: rect(10, 10, 20, 20) })]);
    const after = createScene([surface('a', { rect: rect(10, 10, 20, 20), isVisible: false })]);
    const change = invalidate(before, after);

    expect(reasonsOf(change, 'a')).toEqual(['visibility']);
    expect(change.damage).toEqual(rect(10, 10, 20, 20));
  });

  it('marks a band or ordinal change as a reorder', () => {
    // A renderer keeping a display list can skip rebuilding it when this is
    // false, even though surfaces moved.
    const before = createScene([surface('a')]);

    expect(invalidate(before, createScene([surface('a', { layer: 'overlay' })])).reordered).toBe(
      true,
    );
    expect(invalidate(before, createScene([surface('a', { ordinal: 3 })])).reordered).toBe(true);
    expect(
      invalidate(before, createScene([surface('a', { rect: rect(1, 1, 100, 100) })])).reordered,
    ).toBe(false);
  });

  it('separates a change that only affects hit testing', () => {
    const before = createScene([surface('a')]);
    const after = createScene([surface('a', { pointerMode: 'click-through' })]);
    const change = invalidate(before, after);

    expect(change.pointerOnly).toBe(true);
    expect(needsRepaint(change)).toBe(false);
    expect(change.damage).toEqual(rect(0, 0, 100, 100));
  });

  it('is not pointer-only when anything else changed too', () => {
    const before = createScene([surface('a'), surface('b')]);
    const after = createScene([
      surface('a', { pointerMode: 'click-through' }),
      surface('b', { rect: rect(5, 5, 100, 100) }),
    ]);

    expect(invalidate(before, after).pointerOnly).toBe(false);
  });

  it('unions damage across surfaces', () => {
    const before = createScene([surface('a', { rect: rect(0, 0, 10, 10) })]);
    const after = createScene([
      surface('a', { rect: rect(0, 0, 10, 10) }),
      surface('b', { rect: rect(90, 90, 10, 10) }),
    ]);

    expect(invalidate(before, after).damage).toEqual(rect(90, 90, 10, 10));
  });

  it('reports surfaces in identity order, so two runs agree', () => {
    const before = createScene();
    const after = createScene([surface('zulu'), surface('alpha'), surface('mike')]);

    expect(invalidate(before, after).surfaces.map((entry) => entry.surfaceId)).toEqual([
      'alpha',
      'mike',
      'zulu',
    ]);
  });
});

describe('mergeInvalidations', () => {
  it('returns the other when one is empty', () => {
    const change = invalidate(createScene(), createScene([surface('a')]));
    expect(mergeInvalidations(NO_INVALIDATION, change)).toBe(change);
    expect(mergeInvalidations(change, NO_INVALIDATION)).toBe(change);
  });

  it('reports the distance actually travelled across dropped frames', () => {
    // A surface that moved twice must repaint everywhere it has been, not just
    // its last hop.
    const first = createScene([surface('a', { rect: rect(0, 0, 10, 10) })]);
    const second = createScene([surface('a', { rect: rect(40, 0, 10, 10) })]);
    const third = createScene([surface('a', { rect: rect(90, 0, 10, 10) })]);

    const merged = mergeInvalidations(invalidate(first, second), invalidate(second, third));

    expect(merged.damage).toEqual(rect(0, 0, 100, 10));
    expect(merged.surfaces[0]?.before).toEqual(rect(0, 0, 10, 10));
    expect(merged.surfaces[0]?.after).toEqual(rect(90, 0, 10, 10));
  });

  it('unions the reasons', () => {
    const first = createScene([surface('a')]);
    const second = createScene([surface('a', { rect: rect(5, 5, 100, 100) })]);
    const third = createScene([
      surface('a', { rect: rect(5, 5, 100, 100), appearance: { opacity: 0.5 } }),
    ]);

    const merged = mergeInvalidations(invalidate(first, second), invalidate(second, third));
    expect(merged.surfaces[0]?.reasons).toEqual(['moved', 'appearance']);
  });

  it('keeps surfaces that appear in only one of them', () => {
    const first = createScene([surface('a')]);
    const second = createScene([surface('a', { rect: rect(5, 5, 100, 100) })]);
    const third = createScene([surface('a', { rect: rect(5, 5, 100, 100) }), surface('b')]);

    const merged = mergeInvalidations(invalidate(first, second), invalidate(second, third));
    expect(merged.surfaces.map((entry) => entry.surfaceId)).toEqual(['a', 'b']);
  });

  it('stays pointer-only only if both were', () => {
    const base = createScene([surface('a')]);
    const pointer = createScene([surface('a', { pointerMode: 'click-through' })]);
    const moved = createScene([
      surface('a', { pointerMode: 'click-through', rect: rect(9, 9, 10, 10) }),
    ]);

    expect(mergeInvalidations(invalidate(base, pointer), NO_INVALIDATION).pointerOnly).toBe(true);
    expect(
      mergeInvalidations(invalidate(base, pointer), invalidate(pointer, moved)).pointerOnly,
    ).toBe(false);
  });
});

// --------------------------------------------------------------- occlusion --

describe('cullOccluded', () => {
  it('culls a surface fully covered by an opaque one above it', () => {
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(10, 10, 20, 20) }),
      surface('over', { layer: 'overlay', rect: rect(0, 0, 100, 100) }),
    ]);
    const result = cullOccluded(scene);

    expect(result.visible.map((entry) => entry.surfaceId)).toEqual(['over']);
    expect(result.occluded.map((entry) => entry.surfaceId)).toEqual(['under']);
    expect(isOccluded(scene, sid('under'))).toBe(true);
  });

  it('keeps a partly covered surface', () => {
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(0, 0, 100, 100) }),
      surface('over', { layer: 'overlay', rect: rect(50, 50, 100, 100) }),
    ]);

    expect(cullOccluded(scene).occluded).toEqual([]);
  });

  it('is not hidden by a translucent surface', () => {
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(10, 10, 20, 20) }),
      surface('over', {
        layer: 'overlay',
        rect: rect(0, 0, 100, 100),
        appearance: { opacity: 0.8 },
      }),
    ]);

    expect(cullOccluded(scene).occluded).toEqual([]);
  });

  it('is not hidden by a blurred surface', () => {
    // A blurred surface samples what is behind it. Culling would remove the very
    // thing the blur is of.
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(10, 10, 20, 20) }),
      surface('glass', {
        layer: 'overlay',
        rect: rect(0, 0, 100, 100),
        appearance: { blurRadius: 24 },
      }),
    ]);

    expect(cullOccluded(scene).occluded).toEqual([]);
  });

  it('does not cull across displays', () => {
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(10, 10, 20, 20) }),
      surface('elsewhere', {
        layer: 'overlay',
        rect: rect(0, 0, 100, 100),
        monitorId: mid('unit:SN-EXTERNAL'),
      }),
    ]);

    expect(cullOccluded(scene).occluded).toEqual([]);
  });

  it('leaves an unpainted surface out of both lists', () => {
    // It was never going to be drawn; reporting it as occluded would suggest
    // something is covering it.
    const scene = createScene([surface('gone', { isVisible: false })]);
    const result = cullOccluded(scene);

    expect(result.visible).toEqual([]);
    expect(result.occluded).toEqual([]);
  });

  it('returns visible surfaces in paint order', () => {
    const scene = createScene([
      surface('bottom', { layer: 'desktop', rect: rect(0, 0, 10, 10) }),
      surface('top', { layer: 'overlay', rect: rect(50, 0, 10, 10) }),
    ]);

    expect(cullOccluded(scene).visible.map((entry) => entry.surfaceId)).toEqual([
      'bottom',
      'top',
    ]);
  });

  it('does not cull a surface covered only by two surfaces between them', () => {
    // Documented conservatism: exact coverage needs a region, and the
    // bookkeeping costs more than the drawing it saves at this scale. Being
    // wrong this way wastes work; being wrong the other way drops something the
    // user should see.
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(0, 0, 100, 100) }),
      surface('left', { layer: 'overlay', ordinal: 0, rect: rect(0, 0, 50, 100) }),
      surface('right', { layer: 'overlay', ordinal: 1, rect: rect(50, 0, 50, 100) }),
    ]);

    expect(cullOccluded(scene).occluded).toEqual([]);
  });
});
