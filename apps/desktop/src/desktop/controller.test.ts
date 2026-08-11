/**
 * The composed desktop, end to end, without a browser.
 *
 * Everything the controller needs is injected — the theme, the display, the
 * timer, the frame source — so the full pipeline runs in Node: placement,
 * reveal ordering, ticking clocks, theme switching, glass, and hit testing.
 *
 * This is what stands in for "I ran it and it looked right". A GUI check tells
 * you it worked once; this tells you which part broke.
 */

import { monitorId, parseWidgetInstanceId, type WidgetInstanceId } from '@devdesk/contracts';
import { fallbackSnapshot, type ThemeSnapshot } from '@devdesk/theme-engine';
import {
  createManualTimer,
  rect,
  type CompositionFrame,
  type ManualTimer,
} from '@devdesk/widget-engine';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ClockView } from '../widgets/clock/clock';
import { DesktopController } from './controller';
import type { ShellDisplay } from './displays';

const START = new Date('2026-08-10T09:05:00').getTime();

function display(): ShellDisplay {
  const id = monitorId('unit:SN-LAPTOP');
  if (!id.ok) throw new Error('fixture');

  return {
    monitorId: id.value,
    name: 'ACME 27',
    isPrimary: true,
    scaleFactor: 1,
    workArea: rect(0, 0, 2560, 1400),
    isFallback: false,
  };
}

/** A frame source the test fires by hand, standing in for RAF. */
function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    source: (callback: () => void) => queue.push(callback),
    fire() {
      for (const callback of queue.splice(0, queue.length)) callback();
    },
  };
}

interface World {
  readonly controller: DesktopController;
  readonly frames: ReturnType<typeof manualFrames>;
  readonly timer: ManualTimer;
  readonly presented: CompositionFrame[];
  readonly views: { current: ReadonlyMap<WidgetInstanceId, ClockView> };
}

async function world(theme: ThemeSnapshot = fallbackSnapshot('dark')): Promise<World> {
  const frames = manualFrames();
  const timer = createManualTimer(START);
  const presented: CompositionFrame[] = [];
  const views: { current: ReadonlyMap<WidgetInstanceId, ClockView> } = {
    current: new Map<WidgetInstanceId, ClockView>(),
  };

  const controller = new DesktopController({
    theme,
    display: display(),
    timer,
    frameSource: frames.source,
    callbacks: {
      onFrame: (frame) => presented.push(frame),
      onViews: (next) => {
        views.current = next;
      },
    },
  });

  await controller.place(timer.now());
  return { controller, frames, timer, presented, views };
}

function viewOf(w: World, ordinal: number): ClockView {
  const instance = w.controller.instances[ordinal - 1];
  if (!instance) throw new Error(`no instance ${ordinal}`);
  const view = w.views.current.get(instance);
  if (!view) throw new Error(`no view for ${instance}`);
  return view;
}

let w: World;
beforeEach(async () => {
  w = await world();
});

describe('placement', () => {
  it('places three clocks into the scene, drawing none of them', () => {
    // No frame is presented, and that is correct: adding surfaces that are not
    // visible damages nothing, so there is nothing to repaint. The desktop
    // exists before anything is on screen.
    expect(w.controller.instances).toHaveLength(3);
    expect(w.controller.scene.size).toBe(3);
    expect(w.presented).toHaveLength(0);
  });

  it('gives every surface the identity of its widget instance', () => {
    // The same rule the real core uses, which is what lets the renderer recover
    // a view from a surface.
    for (const surface of w.controller.scene.ordered) {
      const recovered = parseWidgetInstanceId(surface.surfaceId);
      expect(recovered.ok, surface.surfaceId).toBe(true);
    }
  });

  it('renders the injected time, not the wall clock', () => {
    expect(viewOf(w, 1).time).toBe('09:05');
  });
});

describe('reveal ordering', () => {
  it('draws nothing before the shell reports a paint', () => {
    // AC-FRE-1.1 carried into composition: the surfaces are in the scene and
    // none is painted, so no frame can show an unpainted surface.
    expect(w.controller.scene.painted()).toEqual([]);
    expect(w.presented).toHaveLength(0);
  });

  it('reveals every surface once the shell has painted', () => {
    w.controller.markPainted();
    w.frames.fire();

    const latest = w.presented.at(-1);
    expect(latest?.visible).toHaveLength(3);
  });

  it('paints bottom to top, by band', () => {
    w.controller.markPainted();
    w.frames.fire();

    const layers = w.presented.at(-1)?.visible.map((surface) => surface.layer);
    expect(layers).toEqual(['desktop', 'normal', 'overlay']);
  });
});

describe('the clock runs', () => {
  it('advances on the scheduler cadence, not on its own', () => {
    w.controller.markPainted();
    w.frames.fire();

    expect(viewOf(w, 1).time).toBe('09:05');

    w.timer.advance(60_000);
    expect(viewOf(w, 1).time).toBe('09:06');
  });

  it('advances every clock together', () => {
    w.controller.markPainted();
    w.timer.advance(120_000);

    for (const ordinal of [1, 2, 3]) {
      expect(viewOf(w, ordinal).time, `clock ${ordinal}`).toBe('09:07');
    }
  });

  it('reports one wake-up for the whole desktop', () => {
    // Three clocks, one timer. B-4's argument, observable end to end.
    w.controller.markPainted();
    const before = w.controller.metrics().wakeups;
    w.timer.advance(5_000);

    expect(w.controller.metrics().wakeups - before).toBeLessThanOrEqual(6);
    expect(w.controller.metrics().updates).toBeGreaterThan(0);
  });
});

describe('theme switching', () => {
  it('changes what the clocks render', () => {
    w.controller.markPainted();
    expect(viewOf(w, 1).accent).toBe('#7aa2ff');

    w.controller.applyTheme(fallbackSnapshot('light'));
    w.timer.advance(20);

    expect(viewOf(w, 1).accent).toBe('#1f4bd8');
  });

  it('presents no frame when the theme changes nothing composited', () => {
    // Both fallback themes are opaque, so the *composition* is identical even
    // though every colour changed. The widgets re-render; the compositor does
    // not repaint, because nothing it models moved.
    w.controller.markPainted();
    w.frames.fire();
    const before = w.presented.length;

    w.controller.applyTheme(fallbackSnapshot('light'));
    w.frames.fire();

    expect(w.presented.length).toBe(before);
  });

  it('presents a frame when the theme changes the glass', async () => {
    const dark = fallbackSnapshot('dark');
    const glassy: ThemeSnapshot = {
      ...dark,
      hash: 'test-glass',
      tokens: new Map([
        ...dark.tokens,
        ['surface.glass.opacity' as never, '0.7'],
        ['surface.glass.blur' as never, '20'],
      ]),
    };

    w.controller.markPainted();
    w.frames.fire();
    const before = w.presented.length;

    w.controller.applyTheme(glassy);
    w.frames.fire();

    expect(w.presented.length).toBeGreaterThan(before);
    expect(w.controller.scene.ordered[1]?.appearance.blurRadius).toBe(20);
  });

  it('reaches every clock at once', () => {
    w.controller.markPainted();
    w.controller.applyTheme(fallbackSnapshot('light'));
    w.timer.advance(20);

    const accents = new Set([1, 2, 3].map((ordinal) => viewOf(w, ordinal).accent));
    expect(accents.size).toBe(1);
  });

  it('does not disturb the time', () => {
    w.controller.markPainted();
    w.controller.applyTheme(fallbackSnapshot('light'));
    w.timer.advance(20);

    expect(viewOf(w, 1).time).toBe('09:05');
  });
});

describe('glass', () => {
  it('applies theme glass only to the surfaces that asked for it', async () => {
    const dark = fallbackSnapshot('dark');
    const glassy: ThemeSnapshot = {
      ...dark,
      hash: 'test-glass',
      tokens: new Map([
        ...dark.tokens,
        ['surface.glass.opacity' as never, '0.8'],
        ['surface.glass.blur' as never, '18'],
      ]),
    };

    const scene = await world(glassy);
    scene.controller.markPainted();
    scene.frames.fire();

    const surfaces = scene.controller.scene.ordered;
    // The first demo surface is opaque by design; the other two take the glass.
    expect(surfaces[0]?.appearance.blurRadius).toBe(0);
    expect(surfaces[1]?.appearance.blurRadius).toBe(18);
    expect(surfaces[2]?.appearance.opacity).toBe(0.8);
  });

  it('honours reduced transparency over the theme', async () => {
    const dark = fallbackSnapshot('dark');
    const glassy: ThemeSnapshot = {
      ...dark,
      hash: 'test-glass',
      tokens: new Map([
        ...dark.tokens,
        ['surface.glass.opacity' as never, '0.5'],
        ['surface.glass.blur' as never, '30'],
      ]),
    };

    const frames = manualFrames();
    const timer = createManualTimer(START);
    const controller = new DesktopController({
      theme: glassy,
      display: display(),
      timer,
      frameSource: frames.source,
      callbacks: { onFrame: () => undefined, onViews: () => undefined },
      reducedTransparency: true,
    });
    await controller.place(timer.now());

    for (const surface of controller.scene.ordered) {
      expect(surface.appearance.blurRadius).toBe(0);
      expect(surface.appearance.opacity).toBe(1);
    }
  });
});

describe('hit testing', () => {
  beforeEach(() => {
    w.controller.markPainted();
    w.frames.fire();
  });

  it('routes a click to the topmost interactive surface', () => {
    // The demo overlay is click-through, so a click in the overlap must reach
    // the surface beneath it rather than the one on top.
    const hit = w.controller.hitAt({ x: 250, y: 150 });
    expect(hit?.layer).toBe('normal');
  });

  it('returns nothing where no surface is', () => {
    expect(w.controller.hitAt({ x: 2000, y: 1200 })).toBeUndefined();
  });

  it('finds the bottom surface where nothing overlaps it', () => {
    const hit = w.controller.hitAt({ x: 60, y: 60 });
    expect(hit?.layer).toBe('desktop');
  });

  it('routes nothing before the surfaces are revealed', async () => {
    // An unrevealed surface takes no clicks: not painted, not hit-testable.
    const fresh = await world();
    expect(fresh.controller.hitAt({ x: 60, y: 60 })).toBeUndefined();
  });
});

describe('teardown', () => {
  it('stops the scheduler and releases the widgets', () => {
    w.controller.markPainted();
    w.controller.stop();

    const before = w.controller.metrics().updates;
    w.timer.advance(10_000);

    expect(w.controller.metrics().updates).toBe(before);
  });
});
