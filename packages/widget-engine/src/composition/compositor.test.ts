import { monitorId, surfaceId, type SurfaceId } from '@devdesk/contracts';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import { describe, expect, it } from 'vitest';

import { APPEARANCE_TOKENS, appearanceFromTheme, equalAppearance } from './appearance';
import { Compositor, type CompositionFrame } from './compositor';
import { rect } from './geometry';
import { createScene } from './scene';
import { createCompositionSurface, OPAQUE } from './surface';

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

/** A frame source the test fires by hand, standing in for RAF. */
function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    source: (callback: () => void) => queue.push(callback),
    fire() {
      const pending = queue.splice(0, queue.length);
      for (const callback of pending) callback();
    },
    pending: () => queue.length,
  };
}

function world() {
  const frames = manualFrames();
  const presented: CompositionFrame[] = [];
  const compositor = new Compositor(frames.source, (frame) => presented.push(frame));
  return { frames, presented, compositor };
}

describe('Compositor', () => {
  it('presents one frame for one change, on the next frame callback', () => {
    const { frames, presented, compositor } = world();

    compositor.update(createScene([surface('a')]));
    expect(presented).toHaveLength(0);
    expect(compositor.hasPendingFrame).toBe(true);

    frames.fire();
    expect(presented).toHaveLength(1);
    expect(presented[0]?.sequence).toBe(1);
    expect(presented[0]?.invalidation.surfaces[0]?.surfaceId).toBe('a');
  });

  it('coalesces many changes into one frame', () => {
    // A drag produces dozens of updates a second; the screen refreshes when it
    // refreshes, and one frame presents everything since the last.
    const { frames, presented, compositor } = world();

    for (let step = 0; step < 10; step += 1) {
      compositor.update(createScene([surface('a', { rect: rect(step * 10, 0, 100, 100) })]));
    }

    expect(compositor.metrics.frameRequests).toBe(1);
    frames.fire();

    expect(presented).toHaveLength(1);
    // The whole distance travelled, not the last hop.
    expect(presented[0]?.invalidation.damage).toEqual(rect(0, 0, 190, 100));
  });

  it('drops an update that changed nothing, without scheduling a frame', () => {
    const { frames, presented, compositor } = world();
    const scene = createScene([surface('a')]);

    compositor.update(scene);
    frames.fire();
    presented.length = 0;

    // Rebuilt from equal values: no frame.
    compositor.update(createScene([surface('a')]));
    expect(compositor.hasPendingFrame).toBe(false);
    expect(compositor.metrics.emptyUpdates).toBe(1);

    frames.fire();
    expect(presented).toHaveLength(0);
  });

  it('routes hit tests against the new scene before the frame presents', () => {
    // A click during the gap should land on the surface the user is about to
    // see, not one that is already gone.
    const { compositor } = world();
    compositor.update(createScene([surface('a')]));

    compositor.update(createScene([surface('b', { rect: rect(0, 0, 50, 50) })]));

    expect(compositor.scene.has(sid('b'))).toBe(true);
    expect(compositor.scene.has(sid('a'))).toBe(false);
  });

  it('applies a pointer-only change without a frame', () => {
    const { frames, presented, compositor } = world();
    compositor.update(createScene([surface('a')]));
    frames.fire();
    presented.length = 0;

    compositor.update(createScene([surface('a', { pointerMode: 'click-through' })]));

    expect(compositor.hasPendingFrame).toBe(false);
    expect(compositor.metrics.pointerOnlyUpdates).toBe(1);
    expect(compositor.scene.get(sid('a'))?.pointerMode).toBe('click-through');
  });

  it('presents the pointer change too once pixels move', () => {
    // The pending invalidation keeps accumulating; the next repaint carries it.
    const { frames, presented, compositor } = world();
    compositor.update(createScene([surface('a')]));
    frames.fire();
    presented.length = 0;

    compositor.update(createScene([surface('a', { pointerMode: 'click-through' })]));
    compositor.update(
      createScene([
        surface('a', { pointerMode: 'click-through', rect: rect(10, 0, 100, 100) }),
      ]),
    );

    frames.fire();
    expect(presented).toHaveLength(1);
    expect(presented[0]?.invalidation.surfaces[0]?.reasons).toContain('pointer');
    expect(presented[0]?.invalidation.surfaces[0]?.reasons).toContain('moved');
  });

  it('an update during presentation schedules the next frame rather than being lost', () => {
    const frames = manualFrames();
    const presented: CompositionFrame[] = [];

    const compositor: Compositor = new Compositor(frames.source, (frame) => {
      presented.push(frame);
      // Reentrancy: the presenter itself changes the scene.
      if (frame.sequence === 1) {
        compositor.update(createScene([surface('b')]));
      }
    });

    compositor.update(createScene([surface('a')]));
    frames.fire();
    expect(presented).toHaveLength(1);
    expect(compositor.hasPendingFrame).toBe(true);

    frames.fire();
    expect(presented).toHaveLength(2);
    expect(presented[1]?.scene.has(sid('b'))).toBe(true);
  });

  it('flush presents immediately without a frame callback', () => {
    const { frames, presented, compositor } = world();
    compositor.update(createScene([surface('a')]));

    const frame = compositor.flush();
    expect(frame?.sequence).toBe(1);
    expect(presented).toHaveLength(1);

    // The queued callback finds nothing owed and presents nothing.
    frames.fire();
    expect(presented).toHaveLength(1);
  });

  it('flush returns nothing when nothing is owed', () => {
    const { compositor } = world();
    expect(compositor.flush()).toBeUndefined();
  });

  it('culls occluded surfaces from what a frame says to draw', () => {
    const { frames, presented, compositor } = world();

    compositor.update(
      createScene([
        surface('under', { layer: 'desktop', rect: rect(10, 10, 20, 20) }),
        surface('over', { layer: 'overlay', rect: rect(0, 0, 100, 100) }),
      ]),
    );
    frames.fire();

    expect(presented[0]?.visible.map((entry) => entry.surfaceId)).toEqual(['over']);
    expect(presented[0]?.scene.size).toBe(2);
  });

  it('numbers frames monotonically', () => {
    const { frames, presented, compositor } = world();

    compositor.update(createScene([surface('a')]));
    frames.fire();
    compositor.update(createScene([surface('a', { rect: rect(5, 0, 100, 100) })]));
    frames.fire();

    expect(presented.map((frame) => frame.sequence)).toEqual([1, 2]);
  });
});

// -------------------------------------------------------------- appearance --

describe('appearanceFromTheme', () => {
  it('is opaque when the theme declares no glass', () => {
    // Absence of a token is absence of the effect. A theme must not gain
    // translucency by forgetting to say otherwise.
    const appearance = appearanceFromTheme(fallbackSnapshot('dark'));
    expect(appearance).toEqual(OPAQUE);
  });

  it('reads the glass tokens when the theme declares them', () => {
    const theme = fallbackSnapshot('dark');
    const withGlass = {
      ...theme,
      tokens: new Map([
        ...theme.tokens,
        [APPEARANCE_TOKENS.opacity, '0.85'],
        [APPEARANCE_TOKENS.blur, '24'],
        [APPEARANCE_TOKENS.tint, '#10121680'],
      ]),
    };

    const appearance = appearanceFromTheme(withGlass);
    expect(appearance.opacity).toBe(0.85);
    expect(appearance.blurRadius).toBe(24);
    expect(appearance.tint).toBe('#10121680');
  });

  it('ignores a malformed token rather than throwing', () => {
    // A theme is user-supplied data (TH-1). It cannot make this throw.
    const theme = fallbackSnapshot('dark');
    const broken = {
      ...theme,
      tokens: new Map([
        ...theme.tokens,
        [APPEARANCE_TOKENS.opacity, 'mostly'],
        [APPEARANCE_TOKENS.blur, ''],
      ]),
    };

    expect(appearanceFromTheme(broken)).toEqual(OPAQUE);
  });

  it('clamps what the theme asks for', () => {
    const theme = fallbackSnapshot('dark');
    const excessive = {
      ...theme,
      tokens: new Map([
        ...theme.tokens,
        [APPEARANCE_TOKENS.opacity, '7'],
        [APPEARANCE_TOKENS.blur, '-12'],
      ]),
    };

    const appearance = appearanceFromTheme(excessive);
    expect(appearance.opacity).toBe(1);
    expect(appearance.blurRadius).toBe(0);
  });

  it('reduced transparency wins over everything the theme says', () => {
    // Applied after the tokens, so no theme can express its way around it.
    const theme = fallbackSnapshot('dark');
    const withGlass = {
      ...theme,
      tokens: new Map([
        ...theme.tokens,
        [APPEARANCE_TOKENS.opacity, '0.5'],
        [APPEARANCE_TOKENS.blur, '30'],
        [APPEARANCE_TOKENS.tint, '#000'],
      ]),
    };

    expect(appearanceFromTheme(withGlass, { reducedTransparency: true })).toEqual(OPAQUE);
  });

  it('compares appearances by value', () => {
    expect(equalAppearance(OPAQUE, { ...OPAQUE })).toBe(true);
    expect(equalAppearance(OPAQUE, { ...OPAQUE, blurRadius: 1 })).toBe(false);
  });
});
