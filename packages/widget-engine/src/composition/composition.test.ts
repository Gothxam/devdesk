import { monitorId, surfaceId, type SurfaceId } from '@devdesk/contracts';
import { describe, expect, it } from 'vitest';

import {
  area,
  bounds,
  contains,
  encloses,
  EMPTY_RECT,
  equalRects,
  intersection,
  intersects,
  isEmpty,
  rect,
  union,
} from './geometry';
import {
  COMPOSITION_LAYERS,
  describeLayerGrantError,
  grantLayer,
  isAbove,
  isGrantable,
  layerDepth,
} from './layer';
import { createScene, hitTest, surfacesAt } from './scene';
import {
  compareSurfaces,
  createCompositionSurface,
  equalSurfaces,
  isOccluding,
  isPainted,
  takesPointer,
  withSurface,
} from './surface';

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

function surface(name: string, overrides: Parameters<typeof createCompositionSurface>[0] | object = {}) {
  return createCompositionSurface({
    surfaceId: sid(name),
    monitorId: LAPTOP,
    rect: rect(0, 0, 100, 100),
    ...overrides,
  });
}

// ---------------------------------------------------------------- geometry --

describe('geometry', () => {
  it('clamps a negative extent rather than rejecting it', () => {
    // Keeps every downstream operation total: an empty rectangle intersects
    // nothing and contains nothing, which is the right answer.
    const backwards = rect(10, 10, -5, -5);
    expect(isEmpty(backwards)).toBe(true);
    expect(contains(backwards, { x: 10, y: 10 })).toBe(false);
  });

  it('treats upper bounds as exclusive', () => {
    // Inclusive bounds put a click on a shared edge in two surfaces at once,
    // and which wins then depends on iteration order.
    const left = rect(0, 0, 10, 10);
    const right = rect(10, 0, 10, 10);

    expect(contains(left, { x: 9.999, y: 5 })).toBe(true);
    expect(contains(left, { x: 10, y: 5 })).toBe(false);
    expect(contains(right, { x: 10, y: 5 })).toBe(true);
    expect(intersects(left, right)).toBe(false);
  });

  it('intersects to the overlap, or to empty', () => {
    expect(intersection(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toEqual(rect(5, 5, 5, 5));
    expect(isEmpty(intersection(rect(0, 0, 5, 5), rect(10, 10, 5, 5)))).toBe(true);
  });

  it('ignores an empty operand when unioning', () => {
    // A zero-area rectangle at the origin would drag every union back to the
    // origin — how a damage region silently becomes the whole desktop.
    const away = rect(100, 100, 10, 10);
    expect(union(EMPTY_RECT, away)).toEqual(away);
    expect(union(away, EMPTY_RECT)).toEqual(away);
    expect(bounds([EMPTY_RECT, away])).toEqual(away);
  });

  it('bounds several rectangles', () => {
    expect(bounds([rect(0, 0, 10, 10), rect(90, 90, 10, 10)])).toEqual(rect(0, 0, 100, 100));
    expect(bounds([])).toEqual(EMPTY_RECT);
  });

  it('encloses, with an empty inner always enclosed', () => {
    expect(encloses(rect(0, 0, 100, 100), rect(10, 10, 10, 10))).toBe(true);
    expect(encloses(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(false);
    expect(encloses(rect(0, 0, 10, 10), EMPTY_RECT)).toBe(true);
    expect(encloses(EMPTY_RECT, rect(0, 0, 1, 1))).toBe(false);
  });

  it('treats all empty rectangles as equal', () => {
    expect(equalRects(rect(0, 0, 0, 0), rect(50, 50, 0, 0))).toBe(true);
    expect(area(EMPTY_RECT)).toBe(0);
  });
});

// ------------------------------------------------------------------ layers --

describe('layers', () => {
  it('orders bottom to top', () => {
    expect(COMPOSITION_LAYERS).toEqual(['wallpaper', 'desktop', 'normal', 'overlay', 'system']);
    expect(layerDepth('wallpaper')).toBeLessThan(layerDepth('system'));
    expect(isAbove('overlay', 'normal')).toBe(true);
    expect(isAbove('normal', 'overlay')).toBe(false);
  });

  it('reserves the system layer to the core', () => {
    // WD-9: it is where capability prompts render, and a surface able to draw
    // there could spoof them.
    expect(isGrantable('system')).toBe(false);

    const refused = grantLayer('system');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe('reserved');
  });

  it('refuses the wallpaper layer while Q-1 is open', () => {
    const refused = grantLayer('wallpaper');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe('blocked');
  });

  it('grants the ordinary bands', () => {
    for (const layer of ['desktop', 'normal', 'overlay'] as const) {
      const granted = grantLayer(layer);
      expect(granted.ok, layer).toBe(true);
      if (granted.ok) expect(granted.layer).toBe(layer);
    }
  });

  it('refuses with a reason rather than substituting a band', () => {
    // A surface that asked to be wallpaper and silently became a desktop widget
    // is a bug report about a widget in the wrong place.
    for (const layer of ['system', 'wallpaper'] as const) {
      const refused = grantLayer(layer);
      if (refused.ok) throw new Error('expected a refusal');
      const described = describeLayerGrantError(refused.error);
      expect(described).toContain(layer);
      expect(described).not.toContain('undefined');
    }
  });

  it('defaults a surface to desktop, not normal', () => {
    // A DevDesk surface is part of the desktop rather than a window competing
    // with the user's applications.
    expect(surface('a').layer).toBe('desktop');
  });
});

// ---------------------------------------------------------------- surfaces --

describe('surfaces', () => {
  it('clamps opacity and blur on construction', () => {
    const clamped = surface('a', { appearance: { opacity: 5, blurRadius: -3 } });
    expect(clamped.appearance.opacity).toBe(1);
    expect(clamped.appearance.blurRadius).toBe(0);

    expect(surface('b', { appearance: { opacity: -1 } }).appearance.opacity).toBe(0);
    expect(surface('c', { appearance: { opacity: Number.NaN } }).appearance.opacity).toBe(1);
  });

  it('is visible by default', () => {
    // One added invisible and forgotten about is far harder to notice than one
    // that appears when it should not.
    expect(surface('a').isVisible).toBe(true);
    expect(surface('a').pointerMode).toBe('interactive');
  });

  it('freezes what it builds, and withSurface replaces rather than mutates', () => {
    const before = surface('a');
    const after = withSurface(before, { isVisible: false });

    expect(Object.isFrozen(before)).toBe(true);
    expect(before.isVisible).toBe(true);
    expect(after.isVisible).toBe(false);
    expect(after.surfaceId).toBe(before.surfaceId);
  });

  it('is not painted without a display', () => {
    const detached = surface('a', { monitorId: undefined });
    expect(isPainted(detached)).toBe(false);
    expect(takesPointer(detached)).toBe(false);
  });

  it('is not painted when invisible or fully transparent', () => {
    expect(isPainted(surface('a', { isVisible: false }))).toBe(false);
    expect(isPainted(surface('a', { appearance: { opacity: 0 } }))).toBe(false);
  });

  it('does not take a pointer when click-through', () => {
    // The reason click-through exists: a visible HUD that passes clicks lets
    // the desktop underneath be used.
    const hud = surface('a', { pointerMode: 'click-through' });
    expect(isPainted(hud)).toBe(true);
    expect(takesPointer(hud)).toBe(false);
  });

  it('only a fully opaque, unblurred surface occludes', () => {
    // A blurred surface samples what is behind it, so treating it as occluding
    // would let the compositor skip drawing the very thing the blur is of.
    expect(isOccluding(surface('a'))).toBe(true);
    expect(isOccluding(surface('b', { appearance: { opacity: 0.9 } }))).toBe(false);
    expect(isOccluding(surface('c', { appearance: { blurRadius: 12 } }))).toBe(false);
  });

  it('compares by band, then ordinal, then identity', () => {
    const ordered = [
      surface('z', { layer: 'overlay', ordinal: 0 }),
      surface('a', { layer: 'desktop', ordinal: 5 }),
      surface('b', { layer: 'desktop', ordinal: 1 }),
      surface('c', { layer: 'desktop', ordinal: 1 }),
    ].sort(compareSurfaces);

    expect(ordered.map((entry) => entry.surfaceId)).toEqual(['b', 'c', 'a', 'z']);
  });

  it('is totally ordered even when everything else agrees', () => {
    // Without the identity tie-break the desktop would repaint in a different
    // order on a different run — flicker nobody can reproduce.
    const a = surface('a');
    const b = surface('b');
    expect(compareSurfaces(a, b)).toBeLessThan(0);
    expect(compareSurfaces(b, a)).toBeGreaterThan(0);
    expect(compareSurfaces(a, a)).toBe(0);
  });

  it('compares composited results, not object identity', () => {
    expect(equalSurfaces(surface('a'), surface('a'))).toBe(true);
    expect(equalSurfaces(surface('a'), surface('a', { ordinal: 1 }))).toBe(false);
    expect(equalSurfaces(surface('a'), surface('a', { rect: rect(1, 0, 100, 100) }))).toBe(false);
  });
});

// ------------------------------------------------------------------- scene --

describe('scene', () => {
  it('is empty to start with', () => {
    const scene = createScene();
    expect(scene.size).toBe(0);
    expect(scene.ordered).toEqual([]);
    expect(scene.bounds).toEqual(EMPTY_RECT);
  });

  it('orders on construction, bottom first', () => {
    const scene = createScene([
      surface('top', { layer: 'overlay' }),
      surface('bottom', { layer: 'desktop' }),
    ]);

    expect(scene.ordered.map((entry) => entry.surfaceId)).toEqual(['bottom', 'top']);
  });

  it('replaces rather than mutates', () => {
    const before = createScene([surface('a')]);
    const after = before.with(surface('a', { isVisible: false }));

    expect(before.get(sid('a'))?.isVisible).toBe(true);
    expect(after.get(sid('a'))?.isVisible).toBe(false);
    expect(before.size).toBe(1);
    expect(after.size).toBe(1);
  });

  it('adds, replaces, and removes', () => {
    const scene = createScene([surface('a')]).with(surface('b'));
    expect(scene.size).toBe(2);
    expect(scene.has(sid('b'))).toBe(true);

    const removed = scene.without(sid('b'));
    expect(removed.size).toBe(1);
    expect(removed.has(sid('b'))).toBe(false);
  });

  it('returns itself when removing something that is not there', () => {
    const scene = createScene([surface('a')]);
    expect(scene.without(sid('nothing'))).toBe(scene);
  });

  it('bounds only what is painted', () => {
    const scene = createScene([
      surface('a', { rect: rect(0, 0, 10, 10) }),
      surface('hidden', { rect: rect(500, 500, 10, 10), isVisible: false }),
    ]);

    expect(scene.bounds).toEqual(rect(0, 0, 10, 10));
  });

  it('filters by band and by display', () => {
    const other = mid('unit:SN-EXTERNAL');
    const scene = createScene([
      surface('a', { layer: 'desktop' }),
      surface('b', { layer: 'overlay' }),
      surface('c', { layer: 'desktop', monitorId: other }),
    ]);

    expect(scene.inLayer('desktop').map((entry) => entry.surfaceId)).toEqual(['a', 'c']);
    expect(scene.onMonitor(other).map((entry) => entry.surfaceId)).toEqual(['c']);
    expect(scene.painted()).toHaveLength(3);
  });

  it('replaces everything at once', () => {
    const scene = createScene([surface('a'), surface('b')]).replaceAll([surface('c')]);
    expect(scene.ordered.map((entry) => entry.surfaceId)).toEqual(['c']);
  });
});

// --------------------------------------------------------------- hit tests --

describe('hit testing', () => {
  const stack = createScene([
    surface('under', { layer: 'desktop', rect: rect(0, 0, 100, 100) }),
    surface('over', { layer: 'overlay', rect: rect(50, 50, 100, 100) }),
  ]);

  it('returns the topmost surface at a point', () => {
    expect(hitTest(stack, { x: 60, y: 60 })?.surfaceId).toBe('over');
    expect(hitTest(stack, { x: 10, y: 10 })?.surfaceId).toBe('under');
  });

  it('returns nothing where no surface is', () => {
    // The click belongs to whatever is behind the desktop, not to DevDesk.
    expect(hitTest(stack, { x: 500, y: 500 })).toBeUndefined();
  });

  it('skips a click-through surface and finds what is beneath', () => {
    const scene = createScene([
      surface('under', { layer: 'desktop', rect: rect(0, 0, 100, 100) }),
      surface('hud', {
        layer: 'overlay',
        rect: rect(0, 0, 100, 100),
        pointerMode: 'click-through',
      }),
    ]);

    expect(hitTest(scene, { x: 50, y: 50 })?.surfaceId).toBe('under');
  });

  it('skips an invisible surface', () => {
    const scene = createScene([
      surface('under', { rect: rect(0, 0, 100, 100) }),
      surface('gone', { layer: 'overlay', rect: rect(0, 0, 100, 100), isVisible: false }),
    ]);

    expect(hitTest(scene, { x: 50, y: 50 })?.surfaceId).toBe('under');
  });

  it('skips a surface with no display', () => {
    const scene = createScene([
      surface('detached', { rect: rect(0, 0, 100, 100), monitorId: undefined }),
    ]);

    expect(hitTest(scene, { x: 50, y: 50 })).toBeUndefined();
  });

  it('lists every surface under a point, topmost first', () => {
    // A caller routing input wants the top interactive one; a caller deciding
    // what to redraw wants all of them.
    const found = surfacesAt(stack, { x: 60, y: 60 });
    expect(found.map((entry) => entry.surfaceId)).toEqual(['over', 'under']);
  });

  it('includes a click-through surface in the list but not in the hit', () => {
    const scene = createScene([
      surface('under', { rect: rect(0, 0, 100, 100) }),
      surface('hud', {
        layer: 'overlay',
        rect: rect(0, 0, 100, 100),
        pointerMode: 'click-through',
      }),
    ]);

    expect(surfacesAt(scene, { x: 50, y: 50 }).map((entry) => entry.surfaceId)).toEqual([
      'hud',
      'under',
    ]);
    expect(hitTest(scene, { x: 50, y: 50 })?.surfaceId).toBe('under');
  });

  it('gives one answer on a shared edge', () => {
    const side = createScene([
      surface('left', { rect: rect(0, 0, 10, 10) }),
      surface('right', { rect: rect(10, 0, 10, 10) }),
    ]);

    expect(surfacesAt(side, { x: 10, y: 5 })).toHaveLength(1);
    expect(hitTest(side, { x: 10, y: 5 })?.surfaceId).toBe('right');
  });
});
