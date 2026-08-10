/**
 * The widget runtime end to end, with a real widget.
 *
 * The unit suites check each piece against its own contract. This walks the
 * whole pipeline the architecture describes:
 *
 * ```text
 *  ThemeSnapshot → WidgetContext → WidgetHost → SurfacePort → (the core)
 * ```
 *
 * with the clock as the widget, the real registry, the real host, the real
 * binder, and a fake port standing in for the Rust core. Everything asserted
 * here is something a user would notice: what the clock shows, when its window
 * is revealed, and what happens to it when the theme changes or a display goes
 * away.
 *
 * Time is injected throughout — `TS-6`, no test depends on a wall clock.
 */

import {
  surfaceId,
  widgetId,
  widgetInstanceId,
  type SurfaceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import {
  createEventChannel,
  createWidgetContext,
  createWidgetRegistry,
  WidgetHost,
  WidgetSurfaceBinder,
  type SurfacePlacement,
  type SurfacePort,
  type SurfacePortError,
} from '@devdesk/widget-engine';
import { monitorId } from '@devdesk/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { createClockWidget, type ClockInstance, type ClockView } from './clock/clock';
import { CLOCK_MANIFEST } from './clock/manifest';

// ------------------------------------------------------------- fixtures --

function instance(ordinal: number): WidgetInstanceId {
  const widget = widgetId('devdesk.clock');
  if (!widget.ok) throw new Error('fixture');
  const parsed = widgetInstanceId(widget.value, ordinal);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function monitor(value: string) {
  const parsed = monitorId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

/** A port that records the order of everything the runtime asked the core for. */
class FakeCore implements SurfacePort {
  readonly calls: string[] = [];
  readonly revealed = new Set<string>();
  monitor: string | undefined = 'unit:SN-LAPTOP';

  async acquire(
    instanceId: WidgetInstanceId,
  ): Promise<Result<SurfacePlacement, SurfacePortError>> {
    this.calls.push(`create-hidden:${instanceId}`);
    const surface = surfaceId(instanceId);
    if (!surface.ok) return err({ kind: 'refused', detail: 'bad identity' });

    return ok({
      surfaceId: surface.value,
      monitorId: this.monitor === undefined ? undefined : monitor(this.monitor),
    });
  }

  async reportPainted(surface: SurfaceId): Promise<Result<void, SurfacePortError>> {
    this.calls.push(`reveal:${surface}`);
    this.revealed.add(surface);
    return ok(undefined);
  }

  async release(surface: SurfaceId): Promise<Result<void, SurfacePortError>> {
    this.calls.push(`destroy:${surface}`);
    this.revealed.delete(surface);
    return ok(undefined);
  }
}

/** A time source the test moves by hand. */
function clockAt(start: string) {
  let current = new Date(start);
  return {
    now: () => current,
    advance(minutes: number) {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}

interface Harness {
  readonly host: WidgetHost<ClockView>;
  readonly binder: WidgetSurfaceBinder<ClockView>;
  readonly core: FakeCore;
  readonly time: ReturnType<typeof clockAt>;
}

function harness(): Harness {
  const time = clockAt('2026-08-08T09:05:00');

  // The manifest goes through the same validation a third-party bundle does.
  const registered = createWidgetRegistry().register(CLOCK_MANIFEST);
  if (!registered.ok) throw new Error('the clock manifest must be valid');

  const host = new WidgetHost<ClockView>(registered.value, fallbackSnapshot('dark'));
  const defined = host.define(createClockWidget({ now: time.now }));
  if (!defined.ok) throw new Error('the clock definition must be accepted');

  const core = new FakeCore();
  return { host, binder: new WidgetSurfaceBinder(host, core), core, time };
}

let world: Harness;
beforeEach(() => {
  world = harness();
});

function view(ordinal = 1): ClockView {
  const rendered = world.host.render(instance(ordinal));
  if (!rendered.ok) throw new Error('the widget must be renderable');
  return rendered.value;
}

// ------------------------------------------------------------- the tests --

describe('the manifest', () => {
  it('validates through the third-party path', () => {
    // S-10, DD-008. If the clock could skip validation, the first third-party
    // widget would discover requirements nothing had ever enforced.
    const registry = createWidgetRegistry().register(CLOCK_MANIFEST);
    expect(registry.ok).toBe(true);
  });

  it('requests nothing', () => {
    // AC-FRE-6.1: the default arrangement runs without asking the user for
    // anything.
    expect(CLOCK_MANIFEST.capabilities).toEqual([]);
  });
});

describe('create', () => {
  it('walks the lifecycle in order and stops short of visible', () => {
    return world.binder.place(instance(1)).then((placed) => {
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;

      expect(placed.value.phase).toBe('running');
      // The window was created hidden and nothing revealed it.
      expect(world.core.calls).toEqual(['create-hidden:devdesk.clock#1']);
      expect(world.core.revealed.size).toBe(0);
    });
  });

  it('renders the injected time, not the wall clock', async () => {
    await world.binder.place(instance(1));
    expect(view().time).toBe('09:05');
    expect(view().date).toBe('Sat 8 Aug');
  });

  it('reads its colours from the theme', async () => {
    // The widget never chooses a colour; it asks the resolved theme.
    await world.binder.place(instance(1));
    expect(view().accent).toBe('#7aa2ff');
    expect(view().foreground).toBe('#f2f4f8');
  });
});

describe('reveal', () => {
  it('reveals only after the shell says it painted', async () => {
    // AC-FRE-1.1, end to end: the runtime cannot observe a frame and does not
    // pretend to.
    await world.binder.place(instance(1));
    expect(world.core.revealed.size).toBe(0);

    await world.binder.reportPainted(instance(1));

    expect(world.core.calls).toEqual([
      'create-hidden:devdesk.clock#1',
      'reveal:devdesk.clock#1',
    ]);
    expect(world.core.revealed.has('devdesk.clock#1')).toBe(true);
  });

  it('never reveals a widget that was removed before it painted', async () => {
    await world.binder.place(instance(1));
    await world.binder.remove(instance(1));

    const late = await world.binder.reportPainted(instance(1));
    expect(late.ok).toBe(false);
    expect(world.core.revealed.size).toBe(0);
  });
});

describe('theme switch', () => {
  it('reaches a running widget and changes what it renders', async () => {
    await world.binder.place(instance(1));
    expect(view().accent).toBe('#7aa2ff');

    world.host.applyTheme(fallbackSnapshot('light'));

    expect(view().accent).toBe('#1f4bd8');
    expect(view().foreground).toBe('#101216');
  });

  it('reaches every placed widget at once', async () => {
    for (const ordinal of [1, 2, 3]) await world.binder.place(instance(ordinal));

    world.host.applyTheme(fallbackSnapshot('light'));

    for (const ordinal of [1, 2, 3]) {
      expect(view(ordinal).accent).toBe('#1f4bd8');
    }
  });

  it('does not disturb the time', async () => {
    await world.binder.place(instance(1));
    world.host.applyTheme(fallbackSnapshot('light'));

    expect(view().time).toBe('09:05');
  });

  it('reaches a suspended widget, so resuming does not repaint in old colours', async () => {
    await world.binder.place(instance(1));
    world.host.suspend(instance(1));

    world.host.applyTheme(fallbackSnapshot('light'));
    world.host.resume(instance(1));

    expect(view().accent).toBe('#1f4bd8');
  });
});

describe('display change', () => {
  it('tells a widget its display went away, and it keeps working', async () => {
    // A closed lid is a real state. The clock still knows the time; the shell
    // decides what that should look like.
    await world.binder.place(instance(1));
    expect(view().hasDisplay).toBe(true);

    world.host.moveToMonitor(instance(1), undefined);

    expect(view().hasDisplay).toBe(false);
    expect(view().time).toBe('09:05');
  });

  it('tells a widget it moved to another display', async () => {
    await world.binder.place(instance(1));
    world.host.moveToMonitor(instance(1), monitor('unit:SN-EXTERNAL'));

    expect(world.host.contextOf(instance(1))?.monitorId).toBe('unit:SN-EXTERNAL');
    expect(view().hasDisplay).toBe(true);
  });

  it('leaves the widgets that did not move alone', async () => {
    await world.binder.place(instance(1));
    await world.binder.place(instance(2));

    world.host.moveToMonitor(instance(1), undefined);

    expect(view(1).hasDisplay).toBe(false);
    expect(view(2).hasDisplay).toBe(true);
  });
});

describe('suspend and resume', () => {
  it('stops the clock catching up until it resumes', async () => {
    await world.binder.place(instance(1));
    world.host.suspend(instance(1));

    world.time.advance(45);
    // Suspended: nothing told it to tick, so it still shows the old time.
    expect(view().time).toBe('09:05');

    world.host.resume(instance(1));
    expect(view().time).toBe('09:50');
  });

  it('refuses to suspend something that is not running', async () => {
    world.host.create(instance(1));
    expect(world.host.suspend(instance(1)).ok).toBe(false);
  });
});

describe('ticking', () => {
  it('advances only when asked, and never on its own', async () => {
    // The widget owns no timer. @devdesk/animation owns RAF (§6.2.2), and a
    // widget with its own setInterval is the ad-hoc animation that package
    // exists to prevent. Driven directly here, because `tick` belongs to
    // whoever renders rather than to the runtime.
    const time = clockAt('2026-08-08T09:05:00');
    const definition = createClockWidget({ now: time.now });

    const widget = widgetId('devdesk.clock');
    const surface = surfaceId('devdesk.clock#1');
    if (!widget.ok || !surface.ok) throw new Error('fixture');

    const context = createWidgetContext({
      widgetId: widget.value,
      instanceId: instance(1),
      surfaceId: surface.value,
      monitorId: monitor('unit:SN-LAPTOP'),
      theme: fallbackSnapshot('dark'),
      events: createEventChannel(),
    });

    const clock = definition.create(context) as ClockInstance;
    expect(clock.render(context).time).toBe('09:05');

    time.advance(10);
    expect(clock.render(context).time, 'no tick, no change').toBe('09:05');

    clock.tick();
    expect(clock.render(context).time).toBe('09:15');
  });

  it('renders the same time twice between ticks', async () => {
    // The host reserves the right to call render more than once for one change.
    // A widget that read the clock inside render would drift between two calls
    // that describe one moment.
    await world.binder.place(instance(1));
    world.time.advance(7);

    expect(view().time).toBe(view().time);
    expect(view().time).toBe('09:05');
  });
});

describe('attach and detach', () => {
  it('moves a widget to another surface and keeps it running', async () => {
    await world.binder.place(instance(1));
    world.core.calls.length = 0;

    const moved = await world.binder.moveToNewSurface(instance(1));
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.value.phase).toBe('running');

    // Old surface gone before the new one was asked for.
    expect(world.core.calls).toEqual([
      'destroy:devdesk.clock#1',
      'create-hidden:devdesk.clock#1',
    ]);
  });

  it('rebuilds the widget on the new surface', async () => {
    await world.binder.place(instance(1));
    world.time.advance(30);

    await world.binder.moveToNewSurface(instance(1));

    // A fresh instance read the clock again: the widget was rebuilt, not moved.
    expect(view().time).toBe('09:35');
  });

  it('cannot be rendered while detached', async () => {
    await world.binder.place(instance(1));
    world.host.detach(instance(1));

    expect(world.host.render(instance(1)).ok).toBe(false);
  });
});

describe('destroy', () => {
  it('removes the widget and its window', async () => {
    await world.binder.place(instance(1));
    await world.binder.reportPainted(instance(1));

    const removed = await world.binder.remove(instance(1));
    expect(removed.ok).toBe(true);

    expect(world.host.instanceCount).toBe(0);
    expect(world.core.calls).toEqual([
      'create-hidden:devdesk.clock#1',
      'reveal:devdesk.clock#1',
      'destroy:devdesk.clock#1',
    ]);
  });

  it('leaves the other widgets alone', async () => {
    for (const ordinal of [1, 2]) await world.binder.place(instance(ordinal));

    await world.binder.remove(instance(1));

    expect(world.host.instanceCount).toBe(1);
    expect(view(2).time).toBe('09:05');
  });

  it('lets the same identity be placed again', async () => {
    // The identity persists across a restart, so re-placing it must work — that
    // is what restoring an arrangement does.
    await world.binder.place(instance(1));
    await world.binder.remove(instance(1));

    const again = await world.binder.place(instance(1));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.phase).toBe('running');
  });
});

describe('lifecycle ordering', () => {
  it('never reveals before creating, and never after destroying', async () => {
    for (const ordinal of [1, 2, 3]) {
      await world.binder.place(instance(ordinal));
      await world.binder.reportPainted(instance(ordinal));
    }
    for (const ordinal of [1, 2, 3]) {
      await world.binder.remove(instance(ordinal));
    }

    const seen = new Map<string, string[]>();
    for (const call of world.core.calls) {
      const [action, target] = call.split(':');
      if (action === undefined || target === undefined) continue;
      seen.set(target, [...(seen.get(target) ?? []), action]);
    }

    for (const [target, actions] of seen) {
      expect(actions, target).toEqual(['create-hidden', 'reveal', 'destroy']);
    }
  });

  it('produces no core call for a widget that is only created', () => {
    world.host.create(instance(1));
    expect(world.core.calls).toEqual([]);
  });
});
