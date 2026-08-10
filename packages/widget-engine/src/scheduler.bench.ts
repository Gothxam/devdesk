/**
 * What the scheduler costs.
 *
 * Two questions, and they are different:
 *
 * - **Update latency** — how long one widget takes to go from "something
 *   changed" to "new state". This is the number that multiplies by widget count
 *   on a topology change or a theme switch.
 * - **Scheduler overhead** — what the machinery costs when it is *not* doing
 *   useful work: an idle pass, a throttled request, a suspended widget. This is
 *   the number that runs forever on a desktop nobody is touching, and the one
 *   `B-4` is about.
 *
 * The widget under measurement does close to nothing, on purpose. Measuring a
 * realistic widget would report the widget; what needs watching here is the cost
 * the runtime adds around it, so a regression in the runtime is not hidden
 * behind whatever a clock happens to do.
 *
 * Informational under `ADR-0002` `D-2`/`MM-1`: a developer machine, not the
 * §6.1 reference machine.
 */

import {
  monitorId,
  surfaceId,
  widgetId,
  widgetInstanceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import { bench, describe } from 'vitest';

import type { WidgetContext } from './context';
import { everyMs, NO_CADENCE, type WidgetDefinition, type WidgetUpdate } from './definition';
import { WidgetHost } from './host';
import { createWidgetRegistry } from './registry';
import { WidgetScheduler } from './scheduler';
import { createManualTimer, type ManualTimer } from './timer';
import { NEVER_SUSPEND } from './visibility';

const CLOCK = 'devdesk.clock';
const TICK = 1_000;

/** A realistic desktop. ADR-0002's W2 workload is 24 surfaces; 32 is above it. */
const FLEET = 32;

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

/** As close to nothing as a widget can be, so the runtime is what is measured. */
function minimal(cadence = NO_CADENCE): WidgetDefinition<number, number> {
  return {
    id: id(CLOCK),
    cadence,
    initialize: (_context: WidgetContext, at: number): number => at,
    update: (_state: number, update: WidgetUpdate): number => update.at,
    render: (state: number) => state,
  };
}

interface World {
  readonly host: WidgetHost<number, number>;
  readonly scheduler: WidgetScheduler<number, number>;
  readonly timer: ManualTimer;
  readonly placed: readonly WidgetInstanceId[];
}

function world(count: number, cadence = NO_CADENCE): World {
  const registered = createWidgetRegistry().register(MANIFEST);
  if (!registered.ok) throw new Error('fixture');

  const host = new WidgetHost<number, number>(registered.value, fallbackSnapshot('dark'));
  if (!host.define(minimal(cadence)).ok) throw new Error('fixture');

  const timer = createManualTimer();
  // NEVER_SUSPEND so the benchmark measures scheduling rather than the policy
  // deciding to skip everything. The policy's own cost is measured separately.
  const scheduler = new WidgetScheduler(host, timer, { suspendPolicy: NEVER_SUSPEND });

  const placed: WidgetInstanceId[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    const target = instance(ordinal);
    host.create(target);
    host.attach(
      target,
      { surfaceId: surface(`surface-${ordinal}`), monitorId: monitor('unit:SN-LAPTOP') },
      timer.now(),
    );
    host.start(target);
    host.flush(target, timer.now());
    scheduler.register(target);
    scheduler.setVisibility(target, 'visible');
    placed.push(target);
  }

  scheduler.start();
  return { host, scheduler, timer, placed: Object.freeze(placed) };
}

// ------------------------------------------------------------------ latency --

describe('update latency', () => {
  const one = world(1);
  const target = one.placed[0];
  if (!target) throw new Error('fixture');

  bench('mark dirty and flush one widget', () => {
    one.host.markDirty(target, 'requested');
    one.host.flush(target, one.timer.now());
  });

  bench('render one widget', () => {
    one.host.render(target);
  });

  const fleet = world(FLEET);
  bench(`flush ${FLEET} dirty widgets in one pass`, () => {
    for (const placed of fleet.placed) fleet.host.markDirty(placed, 'requested');
    fleet.scheduler.flushDue();
  });

  const themed = world(FLEET);
  let mode = false;
  bench(`theme switch across ${FLEET} widgets`, () => {
    mode = !mode;
    // Rebuilds every context and marks every instance dirty. The update itself
    // is deferred to the next pass, which is the point of the split.
    themed.host.applyTheme(fallbackSnapshot(mode ? 'light' : 'dark'));
  });
});

// ----------------------------------------------------------------- overhead --

describe('scheduler overhead', () => {
  const idle = world(FLEET);
  bench(`idle pass, ${FLEET} widgets, nothing dirty`, () => {
    // What runs forever on a desktop nobody is touching. Every widget is
    // inspected and none is run.
    idle.scheduler.flushDue();
  });

  const throttled = world(FLEET);
  bench(`${FLEET} requests inside one throttle window`, () => {
    // The burst case: everything asks, nothing is permitted to run, and the
    // causes accumulate for the next flush.
    for (const placed of throttled.placed) throttled.scheduler.request(placed, 'requested');
  });

  const coalescing = world(1);
  const single = coalescing.placed[0];
  if (!single) throw new Error('fixture');

  bench('coalesce 6 causes into one update', () => {
    for (const reason of [
      'attached',
      'resumed',
      'theme-changed',
      'monitor-changed',
      'interval',
      'requested',
    ] as const) {
      coalescing.host.markDirty(single, reason);
    }
    coalescing.host.flush(single, coalescing.timer.now());
  });

  const policy = world(FLEET);
  bench(`visibility change across ${FLEET} widgets`, () => {
    for (const placed of policy.placed) {
      policy.scheduler.setVisibility(placed, 'hidden');
      policy.scheduler.setVisibility(placed, 'visible');
    }
  });

  const cadenced = world(FLEET, everyMs(TICK));
  bench(`one second of cadence, ${FLEET} widgets`, () => {
    // One wake-up, 32 updates. The number that matters for B-4 at steady state.
    cadenced.timer.advance(TICK);
  });
});
