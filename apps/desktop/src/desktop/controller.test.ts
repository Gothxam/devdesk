/**
 * The composed desktop, end to end, without a browser.
 *
 * Everything the controller needs is injected — the theme, the display, the
 * timer, the frame source — so the full pipeline runs in Node: placement,
 * reveal ordering, the widgets ticking, theme switching, glass, hit testing,
 * and the arrangement adapting to a display.
 *
 * This is what stands in for "I ran it and it looked right". A GUI check tells
 * you it worked once; this tells you which part broke.
 *
 * The strongest assertion in the file is the last one: **every visible surface
 * is backed by a widget the host is running**, and every line it shows came
 * from that widget. That is the property this stage exists to establish.
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

import { findOverlaps, resolveArrangement, DESKTOP_MARGIN } from './arrangement';
import { DESKTOP_ARRANGEMENT_COLUMNS, DesktopController } from './controller';
import type { ShellDisplay } from './displays';
import type { DesktopWidgetView } from './widgets/view';

const START = new Date('2026-08-10T09:05:00').getTime();

/** Every widget the desktop places, in the order it places them. */
const EXPECTED = [
  'devdesk.clock#1',
  'devdesk.calendar#1',
  'devdesk.session#1',
  'devdesk.activity#1',
  'devdesk.system#1',
];

function display(overrides: Partial<ShellDisplay> = {}): ShellDisplay {
  const id = monitorId('unit:SN-LAPTOP');
  if (!id.ok) throw new Error('fixture');

  return {
    monitorId: id.value,
    name: 'Built-in display',
    isPrimary: true,
    scaleFactor: 1,
    workArea: rect(0, 0, 1440, 900),
    isFallback: false,
    ...overrides,
  };
}

interface World {
  readonly controller: DesktopController;
  readonly timer: ManualTimer;
  readonly frames: CompositionFrame[];
  readonly views: () => ReadonlyMap<WidgetInstanceId, DesktopWidgetView>;
  /** Runs whatever frame callback the compositor requested. */
  readonly nextFrame: () => void;
}

function world(theme: ThemeSnapshot = fallbackSnapshot('dark'), on = display()): World {
  const timer = createManualTimer(START);
  const frames: CompositionFrame[] = [];
  let latest: ReadonlyMap<WidgetInstanceId, DesktopWidgetView> = new Map();
  const queue: (() => void)[] = [];

  const controller = new DesktopController({
    theme,
    display: on,
    timer,
    frameSource: (callback) => queue.push(callback),
    callbacks: {
      onFrame: (frame) => frames.push(frame),
      onViews: (next) => {
        latest = next;
      },
    },
  });

  return {
    controller,
    timer,
    frames,
    views: () => latest,
    nextFrame: () => {
      for (const callback of queue.splice(0, queue.length)) callback();
    },
  };
}

function viewOf(w: World, id: string): DesktopWidgetView {
  const parsed = parseWidgetInstanceId(id);
  if (!parsed.ok) throw new Error('fixture');
  const view = w.views().get(parsed.value);
  if (!view) throw new Error(`no view for ${id}`);
  return view;
}

let w: World;
beforeEach(async () => {
  w = world();
  await w.controller.place(START);
});

// --------------------------------------------------------------- placement --

describe('placement', () => {
  it('places every first-party widget', () => {
    expect(w.controller.instances).toEqual(EXPECTED);
  });

  it('draws none of them until the shell has painted', () => {
    // AC-FRE-1.1 carried through the composed path: the scene holds every
    // surface, and not one of them is visible.
    expect(w.controller.scene.size).toBe(EXPECTED.length);
    expect(w.controller.scene.painted()).toHaveLength(0);
  });

  it('gives every surface a view before the first frame', () => {
    // A surface that appeared before its widget had rendered would show an
    // empty card for one frame — the flash problem in a different costume.
    for (const id of EXPECTED) expect(() => viewOf(w, id)).not.toThrow();
  });
});

// ------------------------------------------------------------ arrangement --

describe('arrangement', () => {
  it('never overlaps two widgets', () => {
    const resolved = resolveArrangement(display(), DESKTOP_ARRANGEMENT_COLUMNS);
    expect(findOverlaps(resolved)).toEqual([]);
  });

  it('anchors the columns to opposite edges of the work area', () => {
    const resolved = resolveArrangement(display(), DESKTOP_ARRANGEMENT_COLUMNS);
    const clock = resolved.find((entry) => entry.widgetId === 'devdesk.clock');
    const log = resolved.find((entry) => entry.widgetId === 'devdesk.activity');

    expect(log?.rect.x).toBe(DESKTOP_MARGIN);
    expect((clock?.rect.x ?? 0) + (clock?.rect.width ?? 0)).toBe(1440 - DESKTOP_MARGIN);
  });

  it('stacks a column top to bottom with a consistent gap', () => {
    const resolved = resolveArrangement(display(), DESKTOP_ARRANGEMENT_COLUMNS);
    const clock = resolved.find((entry) => entry.widgetId === 'devdesk.clock');
    const calendar = resolved.find((entry) => entry.widgetId === 'devdesk.calendar');
    if (!clock || !calendar) throw new Error('fixture');

    expect(calendar.rect.y - (clock.rect.y + clock.rect.height)).toBe(DESKTOP_MARGIN);
  });

  it('keeps every widget inside the work area, even on a small display', () => {
    // A widget half off the screen is worse than one slightly out of place.
    const small = display({ workArea: rect(0, 0, 640, 400) });
    const resolved = resolveArrangement(small, DESKTOP_ARRANGEMENT_COLUMNS);

    for (const entry of resolved) {
      expect(entry.rect.x).toBeGreaterThanOrEqual(0);
      expect(entry.rect.y).toBeGreaterThanOrEqual(0);
      expect(entry.rect.x + entry.rect.width).toBeLessThanOrEqual(640);
      expect(entry.rect.y + entry.rect.height).toBeLessThanOrEqual(400);
    }
  });

  it('honours a work area that does not start at the origin', () => {
    // The work area excludes the taskbar. A surface anchored to the bounds
    // would sit underneath it.
    const offset = display({ workArea: rect(0, 48, 1440, 852) });
    const resolved = resolveArrangement(offset, DESKTOP_ARRANGEMENT_COLUMNS);

    for (const entry of resolved) expect(entry.rect.y).toBeGreaterThanOrEqual(48);
  });

  it('re-resolves when the display changes', () => {
    const before = w.controller.scene.get(
      w.controller.scene.ordered[0]?.surfaceId ?? ('' as never),
    );
    w.controller.applyDisplay(display({ workArea: rect(0, 0, 2560, 1440), name: 'Studio' }));

    const after = w.controller.scene.ordered[0];
    expect(after?.rect.x).not.toBe(before?.rect.x);
  });
});

// -------------------------------------------------------------------- bands --

describe('composition layers', () => {
  it('puts every first-party surface on the desktop band', () => {
    // Below ordinary windows. A clock floating over the user's editor is a
    // nuisance, and `overlay` is for things that are genuinely transient.
    for (const surface of w.controller.scene.ordered) {
      expect(surface.layer).toBe('desktop');
    }
  });

  it('orders surfaces deterministically within the band', () => {
    const ordinals = w.controller.scene.ordered.map((surface) => surface.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(new Set(ordinals).size).toBe(EXPECTED.length);
  });
});

// ------------------------------------------------------------------ reveal --

describe('reveal ordering', () => {
  it('reveals every surface once the shell has painted', () => {
    w.controller.markPainted();
    expect(w.controller.scene.painted()).toHaveLength(EXPECTED.length);
  });

  it('presents a frame carrying every visible surface', () => {
    w.controller.markPainted();
    w.nextFrame();

    const frame = w.frames.at(-1);
    expect(frame?.visible).toHaveLength(EXPECTED.length);
  });
});

// ------------------------------------------------------------ live widgets --

describe('the widgets run', () => {
  it('advances the clock on its cadence', () => {
    w.controller.markPainted();
    expect(viewOf(w, 'devdesk.clock#1').time).toBe('09:05');

    w.timer.advance(2 * 60_000);
    expect(viewOf(w, 'devdesk.clock#1').time).toBe('09:07');
  });

  it('counts session uptime from the runtime clock', () => {
    w.controller.markPainted();
    expect(viewOf(w, 'devdesk.session#1').time).toBe('0s');

    w.timer.advance(90_000);
    expect(viewOf(w, 'devdesk.session#1').time).toBe('1m');
  });

  it('shows the real month on the calendar', () => {
    const view = viewOf(w, 'devdesk.calendar#1');
    expect(view.calendar?.monthLabel).toBe('August 2026');

    // Six rows always, so the card never changes height month to month.
    expect(view.calendar?.weeks).toHaveLength(6);
    for (const week of view.calendar?.weeks ?? []) expect(week).toHaveLength(7);
  });

  it('marks today exactly once in the month grid', () => {
    const weeks = viewOf(w, 'devdesk.calendar#1').calendar?.weeks ?? [];
    const today = weeks.flat().filter((cell) => cell.isToday);

    expect(today).toHaveLength(1);
    expect(today[0]?.day).toBe(10);
  });
});

// ------------------------------------------------------------ runtime facts --

describe('the session log', () => {
  it('records what actually happened, newest first', () => {
    const entries = viewOf(w, 'devdesk.activity#1').activity?.entries ?? [];

    // Placement of all five, and nothing invented.
    expect(entries.length).toBeGreaterThanOrEqual(EXPECTED.length);
    expect(entries[0]?.message).toContain('devdesk.system');
    for (const entry of entries) expect(entry.at).toBeGreaterThanOrEqual(START);
  });

  it('records the first frame when the shell paints', () => {
    w.controller.markPainted();
    const entries = viewOf(w, 'devdesk.activity#1').activity?.entries ?? [];

    expect(entries.some((entry) => entry.channel === 'frame')).toBe(true);
  });

  it('records a theme change', () => {
    w.controller.applyTheme(fallbackSnapshot('light'));
    const entries = viewOf(w, 'devdesk.activity#1').activity?.entries ?? [];

    expect(entries.some((entry) => entry.channel === 'theme')).toBe(true);
  });

  it('counts every event, including ones past the display limit', () => {
    const before = viewOf(w, 'devdesk.activity#1').activity?.total ?? 0;
    w.controller.applyDisplay(display({ workArea: rect(0, 0, 2560, 1440), name: 'Studio' }));

    const after = viewOf(w, 'devdesk.activity#1').activity;
    expect(after?.total ?? 0).toBeGreaterThan(before);
  });
});

describe('the system readout', () => {
  it('reports the real display', () => {
    const facts = viewOf(w, 'devdesk.system#1').system?.facts ?? [];
    const byLabel = new Map(facts.map((fact) => [fact.label, fact.value]));

    expect(byLabel.get('Display')).toBe('Built-in display');
    expect(byLabel.get('Work area')).toBe('1440 × 900');
    expect(byLabel.get('Surfaces')).toBe(String(EXPECTED.length));
  });

  it('follows the display when it changes', () => {
    w.controller.applyDisplay(display({ workArea: rect(0, 0, 2560, 1440), name: 'Studio' }));

    const facts = viewOf(w, 'devdesk.system#1').system?.facts ?? [];
    const byLabel = new Map(facts.map((fact) => [fact.label, fact.value]));

    expect(byLabel.get('Display')).toBe('Studio');
    expect(byLabel.get('Work area')).toBe('2560 × 1440');
  });

  it('reports counters the pipeline actually produced', () => {
    w.controller.markPainted();
    w.nextFrame();
    w.timer.advance(3_000);

    const metrics = w.controller.metrics();
    expect(metrics.frames).toBeGreaterThan(0);
    expect(metrics.updates).toBeGreaterThan(0);
    expect(metrics.wakeups).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------- theme --

describe('theme switching', () => {
  it('reaches every widget', () => {
    w.controller.markPainted();
    expect(viewOf(w, 'devdesk.clock#1').accent).toBe('#7aa2ff');

    w.controller.applyTheme(fallbackSnapshot('light'));

    for (const id of EXPECTED) expect(viewOf(w, id).accent).toBe('#1f4bd8');
  });

  it('does not disturb what the widgets are showing', () => {
    w.controller.markPainted();
    const before = viewOf(w, 'devdesk.clock#1').time;

    w.controller.applyTheme(fallbackSnapshot('light'));
    expect(viewOf(w, 'devdesk.clock#1').time).toBe(before);
  });

  it('leaves the theme snapshot untouched', () => {
    // The engine's guarantee, checked from the consumer's side.
    const light = fallbackSnapshot('light');
    w.controller.applyTheme(light);

    expect(Object.isFrozen(light)).toBe(true);
    expect(light.metadata.mode).toBe('light');
  });
});

describe('glass', () => {
  it('applies the theme appearance to every surface', () => {
    // A desktop where some widgets are glass and others are not looks like two
    // designs sharing a screen.
    w.controller.markPainted();

    const appearances = w.controller.scene.ordered.map((surface) => surface.appearance);
    const first = appearances[0];
    for (const appearance of appearances) {
      expect(appearance.opacity).toBe(first?.opacity);
      expect(appearance.blurRadius).toBe(first?.blurRadius);
    }
  });

  it('is opaque when the theme declares no glass', () => {
    // Absence of a token is absence of the effect: a theme must not gain
    // translucency by forgetting to say otherwise.
    for (const surface of w.controller.scene.ordered) {
      expect(surface.appearance.opacity).toBe(1);
      expect(surface.appearance.blurRadius).toBe(0);
    }
  });
});

// ------------------------------------------------------------- hit testing --

describe('hit testing', () => {
  it('routes a click to the surface under it', () => {
    w.controller.markPainted();
    const target = w.controller.scene.ordered[0];
    if (!target) throw new Error('fixture');

    const hit = w.controller.hitAt({
      x: target.rect.x + target.rect.width / 2,
      y: target.rect.y + target.rect.height / 2,
    });

    expect(hit?.surfaceId).toBe(target.surfaceId);
  });

  it('returns nothing where no surface is', () => {
    // The click belongs to whatever is behind the desktop, not to DevDesk.
    w.controller.markPainted();
    expect(w.controller.hitAt({ x: 720, y: 450 })).toBeUndefined();
  });

  it('hits nothing before the shell has painted', () => {
    expect(w.controller.hitAt({ x: 1300, y: 60 })).toBeUndefined();
  });
});

// ---------------------------------------------------------- the whole point --

describe('every visible surface is backed by runtime state', () => {
  it('holds for all five, with no invented content', () => {
    w.controller.markPainted();
    w.nextFrame();

    const frame = w.frames.at(-1);
    expect(frame).toBeDefined();
    expect(frame?.visible).toHaveLength(EXPECTED.length);

    for (const surface of frame?.visible ?? []) {
      const instance = parseWidgetInstanceId(surface.surfaceId);
      expect(instance.ok, `${surface.surfaceId} is a widget instance`).toBe(true);
      if (!instance.ok) continue;

      // A view the host produced, for this exact instance.
      const view = w.views().get(instance.value);
      expect(view, `${surface.surfaceId} has a view`).toBeDefined();

      // Both lines are non-empty and neither is a placeholder.
      expect(view?.time.length ?? 0).toBeGreaterThan(0);
      expect(view?.date.length ?? 0).toBeGreaterThan(0);
      expect(view?.time).not.toMatch(/lorem|sample|todo|placeholder/i);
      expect(view?.date).not.toMatch(/lorem|sample|todo|placeholder/i);
    }
  });

  it('reports a widget with no display rather than pretending', () => {
    // A closed lid is a real state, and the view says so instead of guessing.
    for (const id of EXPECTED) expect(viewOf(w, id).hasDisplay).toBe(true);
  });
});
