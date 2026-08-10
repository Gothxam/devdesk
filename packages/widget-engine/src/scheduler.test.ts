import {
  monitorId,
  surfaceId,
  widgetId,
  widgetInstanceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import { beforeEach, describe, expect, it } from 'vitest';

import type { WidgetContext } from './context';
import { everyMs, NO_CADENCE, type WidgetDefinition, type WidgetUpdate } from './definition';
import { WidgetHost } from './host';
import { createWidgetRegistry } from './registry';
import { WidgetScheduler } from './scheduler';
import { SUSPEND_WHEN_UNSEEN, type SuspendPolicy } from './visibility';
import { createManualTimer, type ManualTimer } from './timer';

const CLOCK = 'devdesk.clock';
const TICK = 1_000;

function id(value: string) {
  const parsed = widgetId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function instance(ordinal: number): WidgetInstanceId {
  const parsed = widgetInstanceId(id(CLOCK), ordinal);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function surface(value: string) {
  const parsed = surfaceId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function monitor(value: string) {
  const parsed = monitorId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

const MANIFEST = {
  id: CLOCK,
  name: 'Clock',
  version: '1.0.0',
  description: 'The time.',
  capabilities: [],
  preferredSize: { width: 240, height: 120 },
};

interface State {
  readonly at: number;
  readonly updates: number;
}

interface Recorder extends WidgetDefinition<State, number> {
  readonly seen: () => readonly WidgetUpdate[];
  /** Forgets what it has seen, so a test counts only what it caused. */
  readonly reset: () => void;
}

/** `changes` decides whether the widget reports a new state. */
function recorder(cadence = everyMs(TICK), changes = true): Recorder {
  let seen: WidgetUpdate[] = [];
  return Object.freeze({
    id: id(CLOCK),
    cadence,
    initialize: (_context: WidgetContext, at: number): State => ({ at, updates: 0 }),
    update(state: State, update: WidgetUpdate): State {
      seen.push(update);
      return changes ? { at: update.at, updates: state.updates + 1 } : state;
    },
    render: (state: State) => state.updates,
    seen: () => seen,
    reset: () => {
      seen = [];
    },
  });
}

interface World {
  readonly host: WidgetHost<State, number>;
  readonly scheduler: WidgetScheduler<State, number>;
  readonly timer: ManualTimer;
  readonly definition: Recorder;
}

function world(
  definition = recorder(),
  minIntervalMs?: number,
  policy: SuspendPolicy = SUSPEND_WHEN_UNSEEN,
): World {
  const registered = createWidgetRegistry().register(MANIFEST);
  if (!registered.ok) throw new Error('fixture');

  const host = new WidgetHost<State, number>(registered.value, fallbackSnapshot('dark'));
  const defined = host.define(definition);
  if (!defined.ok) throw new Error('fixture');

  const timer = createManualTimer();
  // The real default. It does not fight a deliberate suspension — it reverses
  // only its own decisions — so these tests can suspend and expect it to stick.
  // The policy's own behaviour has a separate suite.
  const scheduler = new WidgetScheduler(
    host,
    timer,
    minIntervalMs === undefined ? { suspendPolicy: policy } : { minIntervalMs, suspendPolicy: policy },
  );

  return { host, scheduler, timer, definition };
}

/**
 * Places an instance, settles its `attached` update, and registers it.
 *
 * The attach update is consumed here so each test starts from a widget that has
 * run once, which is the steady state the scheduler behaviour is about. The
 * attach update itself is asserted separately.
 */
function place(w: World, ordinal: number): WidgetInstanceId {
  const target = instance(ordinal);
  w.host.create(target);
  w.host.attach(
    target,
    { surfaceId: surface(`surface-${ordinal}`), monitorId: monitor('unit:SN-LAPTOP') },
    w.timer.now(),
  );
  w.host.start(target);
  w.host.flush(target, w.timer.now());
  w.definition.reset();
  w.scheduler.register(target);
  return target;
}

/** Places an instance leaving its `attached` update owed. */
function placeUnsettled(w: World, ordinal: number): WidgetInstanceId {
  const target = instance(ordinal);
  w.host.create(target);
  w.host.attach(
    target,
    { surfaceId: surface(`surface-${ordinal}`), monitorId: monitor('unit:SN-LAPTOP') },
    w.timer.now(),
  );
  w.host.start(target);
  w.scheduler.register(target);
  return target;
}

let w: World;
beforeEach(() => {
  w = world();
});

describe('cadence', () => {
  it('updates a widget on its declared interval', () => {
    const target = place(w, 1);
    w.scheduler.start();

    w.timer.advance(TICK);
    expect(w.definition.seen()).toHaveLength(1);

    w.timer.advance(TICK * 3);
    expect(w.definition.seen()).toHaveLength(4);
    expect(w.host.render(target).ok).toBe(true);
  });

  it('does not update a widget that declares no cadence', () => {
    w = world(recorder(NO_CADENCE));
    place(w, 1);
    w.scheduler.start();

    w.timer.advance(TICK * 10);
    expect(w.definition.seen()).toHaveLength(0);
  });

  it('still updates a widget with no cadence when its context changes', () => {
    // A cadence of none means "never on a timer", not "never".
    w = world(recorder(NO_CADENCE));
    const target = place(w, 1);
    w.scheduler.start();

    w.scheduler.request(target, 'theme-changed');
    w.timer.advance(100);

    expect(w.definition.seen()).toHaveLength(1);
    expect(w.definition.seen()[0]?.reasons).toEqual(['theme-changed']);
  });

  it('keeps the cadence steady rather than drifting by the flush cost', () => {
    place(w, 1);
    w.scheduler.start();

    w.timer.advance(TICK * 5);
    const times = w.definition.seen().map((update) => update.at);

    for (let index = 1; index < times.length; index += 1) {
      expect((times[index] ?? 0) - (times[index - 1] ?? 0)).toBe(TICK);
    }
  });
});

describe('coalescing', () => {
  it('folds every cause since the last flush into one update', () => {
    // A host that applied each cause as it arrived would have run the widget
    // three times.
    const target = place(w, 1);
    w.scheduler.start();
    w.timer.advance(TICK);

    w.scheduler.request(target, 'theme-changed');
    w.scheduler.request(target, 'monitor-changed');
    w.scheduler.request(target, 'requested');

    // One update, and promptly: a theme change must not wait for the next
    // cadence tick to be visible. "Promptly" means the next permitted flush,
    // which is one throttle window after the interval update just above.
    w.timer.advance(16);
    expect(w.definition.seen()).toHaveLength(2);
    expect(w.definition.seen().at(-1)?.reasons).toEqual([
      'theme-changed',
      'monitor-changed',
      'requested',
    ]);

    // And the cadence carries on from there.
    w.timer.advance(TICK);
    expect(w.definition.seen()).toHaveLength(3);
    expect(w.definition.seen().at(-1)?.reasons).toEqual(['interval']);
  });

  it('counts more reasons than updates, which is the whole point', () => {
    const target = place(w, 1);
    w.scheduler.start();

    for (const reason of ['theme-changed', 'monitor-changed', 'requested'] as const) {
      w.scheduler.request(target, reason);
    }
    w.timer.advance(16);

    expect(w.scheduler.metrics.updates).toBe(1);
    expect(w.scheduler.metrics.reasons).toBe(3);
  });

  it('gives every widget in a pass the same timestamp', () => {
    // Read once per pass. Per-widget reads would let a desktop full of clocks
    // show two different minutes for a moment.
    const shared = recorder();
    w = world(shared);
    for (const ordinal of [1, 2, 3]) place(w, ordinal);
    w.scheduler.start();

    w.timer.advance(TICK);

    const times = new Set(shared.seen().map((update) => update.at));
    expect(shared.seen()).toHaveLength(3);
    expect(times.size).toBe(1);
  });
});

describe('throttling', () => {
  it('will not flush an instance more often than the minimum interval', () => {
    w = world(recorder(NO_CADENCE), 100);
    const target = place(w, 1);
    w.scheduler.start();

    w.scheduler.request(target, 'requested');
    w.timer.advance(1);
    expect(w.definition.seen()).toHaveLength(1);

    // A burst inside the window is coalesced into the next permitted flush
    // rather than honoured.
    for (let index = 0; index < 20; index += 1) {
      w.scheduler.request(target, 'requested');
      w.timer.advance(1);
    }
    expect(w.definition.seen()).toHaveLength(1);

    w.timer.advance(100);
    expect(w.definition.seen()).toHaveLength(2);
  });

  it('never throttles an instance that has not run yet', () => {
    // Making a widget wait a frame to appear is the flash problem in a
    // different costume.
    w = world(recorder(NO_CADENCE), 1_000);
    placeUnsettled(w, 1);
    w.scheduler.start();

    w.timer.advance(1);

    expect(w.definition.seen()).toHaveLength(1);
    expect(w.definition.seen()[0]?.reasons).toEqual(['attached']);
  });

  it('reports what it deferred', () => {
    w = world(recorder(NO_CADENCE), 500);
    const target = place(w, 1);
    w.scheduler.start();

    w.scheduler.request(target, 'requested');
    w.timer.advance(1);

    w.scheduler.request(target, 'requested');
    const report = w.scheduler.flushDue();

    expect(report.throttled).toEqual([target]);
    expect(w.scheduler.metrics.throttled).toBe(1);
  });

  it('loses nothing it deferred', () => {
    w = world(recorder(NO_CADENCE), 500);
    const target = place(w, 1);
    w.scheduler.start();

    w.scheduler.request(target, 'requested');
    w.timer.advance(1);
    w.scheduler.request(target, 'theme-changed');
    w.scheduler.flushDue();

    w.timer.advance(500);
    expect(w.definition.seen().at(-1)?.reasons).toContain('theme-changed');
  });
});

describe('suspension', () => {
  it('does not update a suspended widget', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.timer.advance(TICK);
    const before = w.definition.seen().length;

    w.scheduler.suspend(target);
    w.timer.advance(TICK * 10);

    expect(w.definition.seen()).toHaveLength(before);
  });

  it('does not replay every missed interval on resume', () => {
    // Ten intervals elapsed while it was suspended. Resuming catches up once,
    // not ten times — the widget was not there for them, and firing ten updates
    // it would immediately overwrite is work for nobody.
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.suspend(target);
    w.timer.advance(TICK * 10);

    w.scheduler.resume(target);
    w.timer.advance(1);

    expect(w.definition.seen()).toHaveLength(1);
    expect(w.definition.seen()[0]?.reasons).toEqual(['resumed']);
  });

  it('reports what it skipped', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.suspend(target);
    w.host.markDirty(target, 'requested');

    const report = w.scheduler.flushDue();
    expect(report.skipped).toEqual([target]);
    expect(w.scheduler.metrics.skipped).toBe(1);
  });

  it('schedules a resumed widget again', () => {
    // The scheduler cannot observe a phase change. Resuming on the host alone
    // would leave the widget asleep, because nothing would re-arm the wake-up.
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.suspend(target);
    w.timer.advance(TICK * 3);
    expect(w.definition.seen()).toHaveLength(0);

    w.scheduler.resume(target);
    w.timer.advance(TICK * 2);

    // The resume update, then the cadence running again.
    expect(w.definition.seen().length).toBeGreaterThanOrEqual(2);
    expect(w.definition.seen().at(-1)?.reasons).toEqual(['interval']);
  });

  it('a widget suspended straight on the host is still declined', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.host.suspend(target);
    w.host.markDirty(target, 'requested');

    expect(w.scheduler.flushDue().skipped).toEqual([target]);
  });
});

describe('idleness', () => {
  it('holds no timer when nothing is due', () => {
    // B-4: not polling and waking to find nothing to do. Genuinely stopped.
    w = world(recorder(NO_CADENCE));
    place(w, 1);
    w.scheduler.start();

    expect(w.scheduler.isArmed).toBe(false);
    expect(w.timer.pending()).toBe(0);
    expect(w.scheduler.nextWakeAt()).toBeUndefined();
  });

  it('holds one timer for the whole desktop, not one per widget', () => {
    // Forty widgets each holding a setInterval is forty wake-ups a second on a
    // desktop nobody is touching.
    for (const ordinal of [1, 2, 3, 4, 5]) place(w, ordinal);
    w.scheduler.start();

    expect(w.timer.pending()).toBe(1);

    w.timer.advance(TICK * 3);
    expect(w.timer.pending()).toBe(1);
  });

  it('arms again when something asks for an update', () => {
    w = world(recorder(NO_CADENCE));
    const target = place(w, 1);
    w.scheduler.start();
    expect(w.scheduler.isArmed).toBe(false);

    w.scheduler.request(target, 'requested');
    expect(w.scheduler.isArmed).toBe(true);
  });

  it('disarms when the last widget goes away', () => {
    const target = place(w, 1);
    w.scheduler.start();
    expect(w.scheduler.isArmed).toBe(true);

    w.scheduler.unregister(target);
    expect(w.scheduler.isArmed).toBe(false);
  });

  it('stops without losing what is owed', () => {
    // A stopped scheduler is a paused desktop, not a discarded one.
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.request(target, 'theme-changed');
    w.scheduler.stop();

    w.timer.advance(TICK * 5);
    expect(w.definition.seen()).toHaveLength(0);

    w.scheduler.start();
    w.timer.advance(1);
    expect(w.definition.seen()[0]?.reasons).toContain('theme-changed');
  });
});

describe('reporting', () => {
  it('separates what changed from what did not', () => {
    // A widget returning its own state tells the runtime to skip the render.
    w = world(recorder(everyMs(TICK), false));
    const target = place(w, 1);
    w.scheduler.start();

    const report = (() => {
      w.host.markDirty(target, 'requested');
      return w.scheduler.flushDue();
    })();

    expect(report.changed).toEqual([]);
    expect(report.unchanged).toEqual([target]);
  });

  it('reports changed instances so the shell knows what to re-render', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.host.markDirty(target, 'requested');

    expect(w.scheduler.flushDue().changed).toEqual([target]);
  });

  it('flushes in a deterministic order whatever order instances registered in', () => {
    const shared = recorder(NO_CADENCE);
    w = world(shared);
    for (const ordinal of [3, 1, 2]) place(w, ordinal);
    w.scheduler.start();

    for (const ordinal of [3, 1, 2]) w.host.markDirty(instance(ordinal), 'requested');
    const report = w.scheduler.flushDue();

    expect(report.changed).toEqual([instance(1), instance(2), instance(3)]);
  });
});

describe('registration', () => {
  it('refuses an instance the host does not have', () => {
    expect(w.scheduler.register(instance(9))).toBe(false);
    expect(w.scheduler.size).toBe(0);
  });

  it('drops a schedule for an instance that was destroyed underneath it', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.host.destroy(target);

    w.scheduler.flushDue();
    expect(w.scheduler.has(target)).toBe(false);
  });

  it('reads the cadence from the host, so the two cannot disagree', () => {
    const target = place(w, 1);
    expect(w.scheduler.has(target)).toBe(true);

    w.scheduler.start();
    w.timer.advance(TICK);
    expect(w.definition.seen()).toHaveLength(1);
    expect(w.definition.seen()[0]?.reasons).toEqual(['interval']);
  });

  it('runs the attach update as soon as it is started', () => {
    // A freshly placed widget owes an `attached` update. Deferring it to the
    // first cadence tick would leave the surface showing whatever initialize
    // produced for up to a full interval.
    placeUnsettled(w, 1);
    w.scheduler.start();
    w.timer.advance(1);

    expect(w.definition.seen()[0]?.reasons).toEqual(['attached']);
  });
});
