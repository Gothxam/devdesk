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

import { CLOCK_CADENCE_MS, CLOCK_WIDGET } from '../desktop/widgets/clock';
import type { DesktopWidgetState as ClockState } from '../desktop/widgets/state';
import type { DesktopWidgetView as ClockView } from '../desktop/widgets/view';
import { CLOCK_MANIFEST } from '../desktop/widgets/clock';

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

/**
 * The runtime's clock, moved by hand.
 *
 * The widget never reads a clock — every update is handed `at` — so a test
 * advancing time is a test choosing what to pass. No waiting, no fake timers,
 * no flake (`TS-6`).
 */
function runtimeClock(startIso: string) {
  let now = new Date(startIso).getTime();
  return {
    now: () => now,
    advance(minutes: number) {
      now += minutes * 60_000;
    },
  };
}

interface Harness {
  readonly host: WidgetHost<ClockState, ClockView>;
  readonly binder: WidgetSurfaceBinder<ClockState, ClockView>;
  readonly core: FakeCore;
  readonly time: ReturnType<typeof runtimeClock>;
}

function harness(): Harness {
  const time = runtimeClock('2026-08-08T09:05:00');

  // The manifest goes through the same validation a third-party bundle does.
  const registered = createWidgetRegistry().register(CLOCK_MANIFEST);
  if (!registered.ok) throw new Error('the clock manifest must be valid');

  const host = new WidgetHost<ClockState, ClockView>(registered.value, fallbackSnapshot('dark'));
  const defined = host.define(CLOCK_WIDGET);
  if (!defined.ok) throw new Error('the clock definition must be accepted');

  const core = new FakeCore();
  return { host, binder: new WidgetSurfaceBinder(host, core), core, time };
}

/** Marks an instance dirty for its cadence and runs the update. */
function tick(ordinal = 1) {
  world.host.markDirty(instance(ordinal), 'interval');
  world.host.flush(instance(ordinal), world.time.now());
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
    return world.binder.place(instance(1), world.time.now()).then((placed) => {
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;

      expect(placed.value.phase).toBe('running');
      // The window was created hidden and nothing revealed it.
      expect(world.core.calls).toEqual(['create-hidden:devdesk.clock#1']);
      expect(world.core.revealed.size).toBe(0);
    });
  });

  it('renders the injected time, not the wall clock', async () => {
    await world.binder.place(instance(1), world.time.now());
    expect(view().time).toBe('09:05');
    expect(view().date).toBe('Saturday, 8 August');
  });

  it('reads its colours from the theme', async () => {
    // The widget never chooses a colour; it asks the resolved theme.
    await world.binder.place(instance(1), world.time.now());
    expect(view().accent).toBe('#7aa2ff');
    expect(view().foreground).toBe('#f2f4f8');
  });
});

describe('reveal', () => {
  it('reveals only after the shell says it painted', async () => {
    // AC-FRE-1.1, end to end: the runtime cannot observe a frame and does not
    // pretend to.
    await world.binder.place(instance(1), world.time.now());
    expect(world.core.revealed.size).toBe(0);

    await world.binder.reportPainted(instance(1));

    expect(world.core.calls).toEqual([
      'create-hidden:devdesk.clock#1',
      'reveal:devdesk.clock#1',
    ]);
    expect(world.core.revealed.has('devdesk.clock#1')).toBe(true);
  });

  it('never reveals a widget that was removed before it painted', async () => {
    await world.binder.place(instance(1), world.time.now());
    await world.binder.remove(instance(1));

    const late = await world.binder.reportPainted(instance(1));
    expect(late.ok).toBe(false);
    expect(world.core.revealed.size).toBe(0);
  });
});

describe('theme switch', () => {
  it('reaches a running widget and changes what it renders', async () => {
    await world.binder.place(instance(1), world.time.now());
    expect(view().accent).toBe('#7aa2ff');

    world.host.applyTheme(fallbackSnapshot('light'));

    expect(view().accent).toBe('#1f4bd8');
    expect(view().foreground).toBe('#101216');
  });

  it('reaches every placed widget at once', async () => {
    for (const ordinal of [1, 2, 3]) await world.binder.place(instance(ordinal), world.time.now());

    world.host.applyTheme(fallbackSnapshot('light'));

    for (const ordinal of [1, 2, 3]) {
      expect(view(ordinal).accent).toBe('#1f4bd8');
    }
  });

  it('does not disturb the time', async () => {
    await world.binder.place(instance(1), world.time.now());
    world.host.applyTheme(fallbackSnapshot('light'));

    expect(view().time).toBe('09:05');
  });

  it('reaches a suspended widget, so resuming does not repaint in old colours', async () => {
    await world.binder.place(instance(1), world.time.now());
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
    await world.binder.place(instance(1), world.time.now());
    expect(view().hasDisplay).toBe(true);

    world.host.moveToMonitor(instance(1), undefined);

    expect(view().hasDisplay).toBe(false);
    expect(view().time).toBe('09:05');
  });

  it('tells a widget it moved to another display', async () => {
    await world.binder.place(instance(1), world.time.now());
    world.host.moveToMonitor(instance(1), monitor('unit:SN-EXTERNAL'));

    expect(world.host.contextOf(instance(1))?.monitorId).toBe('unit:SN-EXTERNAL');
    expect(view().hasDisplay).toBe(true);
  });

  it('leaves the widgets that did not move alone', async () => {
    await world.binder.place(instance(1), world.time.now());
    await world.binder.place(instance(2), world.time.now());

    world.host.moveToMonitor(instance(1), undefined);

    expect(view(1).hasDisplay).toBe(false);
    expect(view(2).hasDisplay).toBe(true);
  });
});

describe('suspend and resume', () => {
  it('leaves the clock stale while suspended, and catches it up on resume', async () => {
    await world.binder.place(instance(1), world.time.now());
    world.host.flush(instance(1), world.time.now());

    world.host.suspend(instance(1));
    world.time.advance(45);

    // Suspended: the scheduler will not flush it, so it shows the old time.
    expect(view().time).toBe('09:05');

    // Resuming marks it dirty with `resumed`, because time passed while it was
    // not updating and whatever it shows is stale by definition.
    world.host.resume(instance(1));
    expect(world.host.pendingReasons(instance(1))).toEqual(['resumed']);

    world.host.flush(instance(1), world.time.now());
    expect(view().time).toBe('09:50');
  });

  it('refuses to suspend something that is not running', async () => {
    world.host.create(instance(1));
    expect(world.host.suspend(instance(1)).ok).toBe(false);
  });
});

describe('cadence', () => {
  it('advances only when the runtime updates it, never on its own', () => {
    // The widget owns no timer. @devdesk/animation owns RAF (§6.2.2), and a
    // widget with its own setInterval would keep running while hidden, while
    // suspended, and while its display was unplugged — spending B-4's idle
    // budget in code nobody could see.
    const at = new Date('2026-08-08T09:05:00').getTime();
    const context = createWidgetContext({
      widgetId: CLOCK_WIDGET.id,
      instanceId: instance(1),
      surfaceId: (() => {
        const parsed = surfaceId('devdesk.clock#1');
        if (!parsed.ok) throw new Error('fixture');
        return parsed.value;
      })(),
      monitorId: monitor('unit:SN-LAPTOP'),
      theme: fallbackSnapshot('dark'),
      events: createEventChannel(),
    });

    const initial = CLOCK_WIDGET.initialize(context, at);
    expect(CLOCK_WIDGET.render(initial, context).time).toBe('09:05');

    // Ten minutes of wall time and no update: nothing changes, because nothing
    // asked the widget anything.
    expect(CLOCK_WIDGET.render(initial, context).time).toBe('09:05');

    const later = CLOCK_WIDGET.update(
      initial,
      { reasons: ['interval'], at: at + 10 * 60_000 },
      context,
    );
    expect(CLOCK_WIDGET.render(later, context).time).toBe('09:15');
  });

  it('declares a cadence the runtime can read without holding the definition', async () => {
    await world.binder.place(instance(1), world.time.now());
    expect(world.host.snapshot(instance(1))?.cadence).toEqual({
      kind: 'interval',
      everyMs: CLOCK_CADENCE_MS,
    });
  });

  it('is pure: the same state, update, and context give the same view', () => {
    const at = 1_000;
    const context = world.host.contextOf(instance(1));
    expect(context).toBeUndefined();

    // Asserted against the definition directly, because purity is a property of
    // the functions rather than of the host that calls them.
    const built = createWidgetContext({
      widgetId: CLOCK_WIDGET.id,
      instanceId: instance(1),
      surfaceId: (() => {
        const parsed = surfaceId('devdesk.clock#1');
        if (!parsed.ok) throw new Error('fixture');
        return parsed.value;
      })(),
      monitorId: undefined,
      theme: fallbackSnapshot('dark'),
      events: createEventChannel(),
    });

    const state = CLOCK_WIDGET.initialize(built, at);
    const update = { reasons: ['interval'] as const, at: at + 5_000 };

    expect(CLOCK_WIDGET.update(state, update, built)).toEqual(
      CLOCK_WIDGET.update(state, update, built),
    );
    expect(CLOCK_WIDGET.render(state, built)).toEqual(CLOCK_WIDGET.render(state, built));
  });

  it('returns its own state when nothing moved time', () => {
    // Returning the same object tells the runtime to skip the render.
    const context = createWidgetContext({
      widgetId: CLOCK_WIDGET.id,
      instanceId: instance(1),
      surfaceId: (() => {
        const parsed = surfaceId('devdesk.clock#1');
        if (!parsed.ok) throw new Error('fixture');
        return parsed.value;
      })(),
      monitorId: undefined,
      theme: fallbackSnapshot('dark'),
      events: createEventChannel(),
    });

    const state = CLOCK_WIDGET.initialize(context, 1_000);
    const unchanged = CLOCK_WIDGET.update(
      state,
      { reasons: ['theme-changed'], at: 9_999 },
      context,
    );

    expect(unchanged).toBe(state);
  });
});

describe('attach and detach', () => {
  it('moves a widget to another surface and keeps it running', async () => {
    await world.binder.place(instance(1), world.time.now());
    world.core.calls.length = 0;

    const moved = await world.binder.moveToNewSurface(instance(1), world.time.now());
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.value.phase).toBe('running');

    // Old surface gone before the new one was asked for.
    expect(world.core.calls).toEqual([
      'destroy:devdesk.clock#1',
      'create-hidden:devdesk.clock#1',
    ]);
  });

  it('reinitialises the widget on the new surface', async () => {
    await world.binder.place(instance(1), world.time.now());
    world.time.advance(30);

    await world.binder.moveToNewSurface(instance(1), world.time.now());

    // Initialised afresh with the runtime clock: the state was discarded with
    // the context it was computed against, not carried over.
    expect(view().time).toBe('09:35');
  });

  it('cannot be rendered while detached', async () => {
    await world.binder.place(instance(1), world.time.now());
    world.host.detach(instance(1));

    expect(world.host.render(instance(1)).ok).toBe(false);
  });
});

describe('destroy', () => {
  it('removes the widget and its window', async () => {
    await world.binder.place(instance(1), world.time.now());
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
    for (const ordinal of [1, 2]) await world.binder.place(instance(ordinal), world.time.now());

    await world.binder.remove(instance(1));

    expect(world.host.instanceCount).toBe(1);
    expect(view(2).time).toBe('09:05');
  });

  it('lets the same identity be placed again', async () => {
    // The identity persists across a restart, so re-placing it must work — that
    // is what restoring an arrangement does.
    await world.binder.place(instance(1), world.time.now());
    await world.binder.remove(instance(1));

    const again = await world.binder.place(instance(1), world.time.now());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.phase).toBe('running');
  });
});

describe('lifecycle ordering', () => {
  it('never reveals before creating, and never after destroying', async () => {
    for (const ordinal of [1, 2, 3]) {
      await world.binder.place(instance(ordinal), world.time.now());
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
