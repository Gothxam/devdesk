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
import { everyMs, type WidgetDefinition, type WidgetUpdate } from './definition';
import { WidgetHost } from './host';
import { createWidgetRegistry } from './registry';
import { WidgetScheduler } from './scheduler';
import { createManualTimer, type ManualTimer } from './timer';
import {
  describeSuspendDecision,
  NEVER_SUSPEND,
  SUSPEND_WHEN_UNSEEN,
  WIDGET_VISIBILITIES,
  type SuspendSignals,
  type WidgetVisibility,
} from './visibility';

// -------------------------------------------------------------- the policy --

function signals(overrides: Partial<SuspendSignals> = {}): SuspendSignals {
  return {
    visibility: 'visible',
    hasDisplay: true,
    phase: 'running',
    ...overrides,
  };
}

describe('SUSPEND_WHEN_UNSEEN', () => {
  it('runs a widget that is on screen', () => {
    expect(SUSPEND_WHEN_UNSEEN.shouldSuspend(signals())).toBe(false);
  });

  it('suspends a widget that is off screen', () => {
    // Its output is not on screen, so computing it spends the idle budget on
    // something nobody will look at.
    expect(SUSPEND_WHEN_UNSEEN.shouldSuspend(signals({ visibility: 'hidden' }))).toBe(true);
  });

  it('suspends a widget with no display', () => {
    expect(SUSPEND_WHEN_UNSEEN.shouldSuspend(signals({ hasDisplay: false }))).toBe(true);
  });

  it('runs a pending widget even with no display', () => {
    // The deadlock this state exists to break: a surface is revealed only once
    // it has painted, so a policy that suspended everything not yet visible
    // would leave the desktop empty with nothing looking broken.
    expect(
      SUSPEND_WHEN_UNSEEN.shouldSuspend(signals({ visibility: 'pending', hasDisplay: false })),
    ).toBe(false);
    expect(SUSPEND_WHEN_UNSEEN.shouldSuspend(signals({ visibility: 'pending' }))).toBe(false);
  });

  it('is pure: the same signals always give the same answer', () => {
    for (const visibility of WIDGET_VISIBILITIES) {
      for (const hasDisplay of [true, false]) {
        const input = signals({ visibility, hasDisplay });
        expect(SUSPEND_WHEN_UNSEEN.shouldSuspend(input)).toBe(
          SUSPEND_WHEN_UNSEEN.shouldSuspend(input),
        );
      }
    }
  });

  it('covers every combination without a gap', () => {
    // A table rather than a claim.
    const table = WIDGET_VISIBILITIES.flatMap((visibility) =>
      [true, false].map((hasDisplay) => ({
        visibility,
        hasDisplay,
        suspend: SUSPEND_WHEN_UNSEEN.shouldSuspend(signals({ visibility, hasDisplay })),
      })),
    );

    expect(table).toEqual([
      { visibility: 'pending', hasDisplay: true, suspend: false },
      { visibility: 'pending', hasDisplay: false, suspend: false },
      { visibility: 'visible', hasDisplay: true, suspend: false },
      { visibility: 'visible', hasDisplay: false, suspend: true },
      { visibility: 'hidden', hasDisplay: true, suspend: true },
      { visibility: 'hidden', hasDisplay: false, suspend: true },
    ]);
  });
});

describe('NEVER_SUSPEND', () => {
  it('decides nothing, whatever it is given', () => {
    for (const visibility of WIDGET_VISIBILITIES) {
      for (const hasDisplay of [true, false]) {
        expect(NEVER_SUSPEND.shouldSuspend(signals({ visibility, hasDisplay }))).toBe(false);
      }
    }
  });
});

describe('describeSuspendDecision', () => {
  it('says what it decided and why', () => {
    for (const visibility of WIDGET_VISIBILITIES) {
      const described = describeSuspendDecision(signals({ visibility }), SUSPEND_WHEN_UNSEEN);
      expect(described.length).toBeGreaterThan(0);
      expect(described).not.toContain('undefined');
    }
  });
});

// --------------------------------------------------- the scheduler using it --

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

interface Counter extends WidgetDefinition<number, number> {
  readonly count: () => number;
  readonly reset: () => void;
}

function counter(): Counter {
  let updates = 0;
  return Object.freeze({
    id: id(CLOCK),
    cadence: everyMs(TICK),
    initialize: (_context: WidgetContext, _at: number): number => 0,
    update: (state: number, _update: WidgetUpdate): number => {
      updates += 1;
      return state + 1;
    },
    render: (state: number) => state,
    count: () => updates,
    reset: () => {
      updates = 0;
    },
  });
}

interface World {
  readonly host: WidgetHost<number, number>;
  readonly scheduler: WidgetScheduler<number, number>;
  readonly timer: ManualTimer;
  readonly definition: Counter;
}

function world(): World {
  const registered = createWidgetRegistry().register(MANIFEST);
  if (!registered.ok) throw new Error('fixture');

  const definition = counter();
  const host = new WidgetHost<number, number>(registered.value, fallbackSnapshot('dark'));
  if (!host.define(definition).ok) throw new Error('fixture');

  const timer = createManualTimer();
  return { host, scheduler: new WidgetScheduler(host, timer), timer, definition };
}

function place(w: World, ordinal: number, withDisplay = true): WidgetInstanceId {
  const target = instance(ordinal);
  w.host.create(target);
  w.host.attach(
    target,
    {
      surfaceId: surface(`surface-${ordinal}`),
      monitorId: withDisplay ? monitor('unit:SN-LAPTOP') : undefined,
    },
    w.timer.now(),
  );
  w.host.start(target);
  w.host.flush(target, w.timer.now());
  w.definition.reset();
  w.scheduler.register(target);
  return target;
}

let w: World;
beforeEach(() => {
  w = world();
});

describe('visibility management', () => {
  it('starts a placed widget pending, and runs it', () => {
    // It has to paint before it can be revealed.
    const target = place(w, 1);
    expect(w.scheduler.visibilityOf(target)).toBe('pending');

    w.scheduler.start();
    w.timer.advance(TICK);
    expect(w.definition.count()).toBe(1);
  });

  it('keeps running a widget that becomes visible', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'visible');

    w.timer.advance(TICK * 3);
    expect(w.definition.count()).toBe(3);
  });

  it('stops a widget the moment it goes off screen', () => {
    // Now rather than at the next pass: a widget that just went off screen
    // should not get one more update nobody sees.
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'visible');
    w.timer.advance(TICK);
    w.definition.reset();

    w.scheduler.setVisibility(target, 'hidden');
    expect(w.host.snapshot(target)?.phase).toBe('suspended');

    w.timer.advance(TICK * 10);
    expect(w.definition.count()).toBe(0);
  });

  it('starts it again when it comes back', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'hidden');
    w.timer.advance(TICK * 5);

    w.scheduler.setVisibility(target, 'visible');
    expect(w.host.snapshot(target)?.phase).toBe('running');

    w.timer.advance(TICK);
    expect(w.definition.count()).toBeGreaterThan(0);
  });

  it('counts what it decided', () => {
    const target = place(w, 1);
    w.scheduler.start();

    w.scheduler.setVisibility(target, 'hidden');
    w.scheduler.setVisibility(target, 'visible');

    expect(w.scheduler.metrics.suspensions).toBe(1);
    expect(w.scheduler.metrics.resumptions).toBe(1);
  });

  it('refuses an instance it does not schedule', () => {
    expect(w.scheduler.setVisibility(instance(9), 'hidden')).toBe(false);
  });
});

describe('the display signal', () => {
  it('suspends a visible widget whose display went away', () => {
    // Re-decided every pass, so unplugging a display stops the widget without
    // anything having to observe the topology change.
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'visible');
    w.timer.advance(TICK);
    w.definition.reset();

    w.host.moveToMonitor(target, undefined);
    w.timer.advance(TICK);

    expect(w.host.snapshot(target)?.phase).toBe('suspended');
    expect(w.definition.count()).toBe(0);
  });

  it('runs it again when a display returns', () => {
    const target = place(w, 1, false);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'visible');
    w.timer.advance(TICK * 2);
    expect(w.host.snapshot(target)?.phase).toBe('suspended');

    w.host.moveToMonitor(target, monitor('unit:SN-EXTERNAL'));
    w.scheduler.setVisibility(target, 'visible');

    expect(w.host.snapshot(target)?.phase).toBe('running');
  });
});

describe('policy and deliberate control', () => {
  it('does not undo a suspension it did not cause', () => {
    // "Never suspend" must not mean "always resume". A caller that stopped a
    // widget deliberately would otherwise find it running again on the next
    // pass because a policy merely disagreed.
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'visible');

    w.scheduler.suspend(target);
    w.timer.advance(TICK * 5);

    expect(w.host.snapshot(target)?.phase).toBe('suspended');
    expect(w.definition.count()).toBe(0);
  });

  it('resumes deliberately, and stays resumed', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.setVisibility(target, 'visible');
    w.scheduler.suspend(target);

    w.scheduler.resume(target);
    w.timer.advance(TICK * 2);

    expect(w.host.snapshot(target)?.phase).toBe('running');
    expect(w.definition.count()).toBeGreaterThan(0);
  });

  it('still suspends a deliberately-resumed widget that goes off screen', () => {
    const target = place(w, 1);
    w.scheduler.start();
    w.scheduler.resume(target);

    w.scheduler.setVisibility(target, 'hidden');
    expect(w.host.snapshot(target)?.phase).toBe('suspended');
  });
});

describe('many widgets', () => {
  it('suspends only the ones that went off screen', () => {
    const first = place(w, 1);
    const second = place(w, 2);
    const third = place(w, 3);
    w.scheduler.start();
    for (const target of [first, second, third]) w.scheduler.setVisibility(target, 'visible');

    w.scheduler.setVisibility(second, 'hidden');

    expect(w.host.snapshot(first)?.phase).toBe('running');
    expect(w.host.snapshot(second)?.phase).toBe('suspended');
    expect(w.host.snapshot(third)?.phase).toBe('running');
  });

  it('goes fully idle when everything is off screen', () => {
    // B-4: a desktop nobody is looking at holds no timer at all.
    const targets: WidgetInstanceId[] = [];
    for (const ordinal of [1, 2, 3]) targets.push(place(w, ordinal));
    w.scheduler.start();
    expect(w.scheduler.isArmed).toBe(true);

    for (const target of targets) w.scheduler.setVisibility(target, 'hidden');

    expect(w.scheduler.isArmed).toBe(false);
    expect(w.timer.pending()).toBe(0);
  });

  it('wakes again as soon as one comes back', () => {
    const targets: WidgetInstanceId[] = [];
    for (const ordinal of [1, 2, 3]) targets.push(place(w, ordinal));
    w.scheduler.start();
    for (const target of targets) w.scheduler.setVisibility(target, 'hidden');

    const first = targets[0];
    if (!first) throw new Error('fixture');
    w.scheduler.setVisibility(first, 'visible');

    expect(w.scheduler.isArmed).toBe(true);
  });
});
