import {
  monitorId,
  surfaceId,
  widgetId,
  widgetInstanceId,
  type SurfaceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import { describe, expect, it } from 'vitest';

import { NO_CADENCE, type WidgetDefinition } from './definition';
import { describeHostError, WidgetHost, type SurfacePlacement } from './host';
import { createWidgetRegistry } from './registry';
import {
  describeBindingError,
  WidgetSurfaceBinder,
  type SurfacePort,
  type SurfacePortError,
} from './surface';

const CLOCK = 'devdesk.clock';

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

function surface(value: string): SurfaceId {
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

/** A port that records what it was asked, and can be told to refuse. */
class FakePort implements SurfacePort {
  readonly calls: string[] = [];
  readonly live = new Set<string>();
  failAcquire = false;
  failRelease = false;
  monitor: string | undefined = 'unit:SN-LAPTOP';
  #next = 0;

  async acquire(
    instanceId: WidgetInstanceId,
  ): Promise<Result<SurfacePlacement, SurfacePortError>> {
    this.calls.push(`acquire:${instanceId}`);
    if (this.failAcquire) return err({ kind: 'refused', detail: 'the core refused' });

    // A second surface for one instance would need a distinct identity; the real
    // core keys on the instance identity, and re-acquiring after release reuses
    // it. Numbering here only proves the binder released before re-acquiring.
    this.#next += 1;
    const name = this.#next === 1 ? instanceId : `${instanceId}/${this.#next}`;
    this.live.add(name);

    return ok({
      surfaceId: surface(name),
      monitorId: this.monitor === undefined ? undefined : monitor(this.monitor),
    });
  }

  async reportPainted(surfaceIdentity: SurfaceId): Promise<Result<void, SurfacePortError>> {
    this.calls.push(`paint:${surfaceIdentity}`);
    if (!this.live.has(surfaceIdentity)) {
      return err({ kind: 'not-found', surfaceId: surfaceIdentity });
    }
    return ok(undefined);
  }

  async release(surfaceIdentity: SurfaceId): Promise<Result<void, SurfacePortError>> {
    this.calls.push(`release:${surfaceIdentity}`);
    if (this.failRelease) return err({ kind: 'refused', detail: 'the core refused' });
    this.live.delete(surfaceIdentity);
    return ok(undefined);
  }
}

function scenario(definition?: WidgetDefinition<number, string>) {
  const registered = createWidgetRegistry().register(MANIFEST);
  if (!registered.ok) throw new Error('fixture');

  const host = new WidgetHost<number, string>(registered.value, fallbackSnapshot('dark'));
  const defined = host.define(
    definition ?? {
      id: id(CLOCK),
      cadence: NO_CADENCE,
      initialize: () => 0,
      update: (state) => state,
      render: (_state, context) => context.surfaceId,
    },
  );
  if (!defined.ok) throw new Error('fixture');

  const port = new FakePort();
  return { host, port, binder: new WidgetSurfaceBinder(host, port) };
}

describe('place', () => {
  it('runs create, acquire, attach, start — and stops there', () => {
    // Not revealed. The window exists and is hidden, the widget is running and
    // producing views, and nothing has told the core to show anything.
    const { host, port, binder } = scenario();

    return binder.place(instance(1), 1_000).then((placed) => {
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;

      expect(placed.value.phase).toBe('running');
      expect(placed.value.surfaceId).toBe('devdesk.clock#1');
      expect(port.calls).toEqual(['acquire:devdesk.clock#1']);
      expect(host.contextOf(instance(1))?.monitorId).toBe('unit:SN-LAPTOP');
    });
  });

  it('reveals only when the shell says it painted', async () => {
    // AC-FRE-1.1. This package cannot observe a frame; inferring one from a
    // timer or from `place` returning is how the flash gets reintroduced by the
    // layer meant to prevent it.
    const { port, binder } = scenario();
    await binder.place(instance(1), 1_000);

    expect(port.calls.some((call) => call.startsWith('paint:'))).toBe(false);

    const painted = await binder.reportPainted(instance(1));
    expect(painted.ok).toBe(true);
    expect(port.calls).toContain('paint:devdesk.clock#1');
  });

  it('places a widget with no display attached', async () => {
    const { host, binder, port } = scenario();
    port.monitor = undefined;

    const placed = await binder.place(instance(1), 1_000);
    expect(placed.ok).toBe(true);
    expect(host.contextOf(instance(1))?.monitorId).toBeUndefined();
  });

  it('leaves nothing behind when the core refuses a surface', async () => {
    const { host, binder, port } = scenario();
    port.failAcquire = true;

    const placed = await binder.place(instance(1), 1_000);
    expect(placed.ok).toBe(false);
    if (!placed.ok) expect(placed.error.kind).toBe('port');

    expect(host.instanceCount).toBe(0);
  });

  it('releases the surface when attaching fails', async () => {
    // Leaving it would strand a hidden window belonging to a widget that does
    // not exist — invisible, unreachable, permanent.
    const { host, binder, port } = scenario();

    // Occupy the identity so `create` inside `place` fails at the host step.
    host.create(instance(1));

    const placed = await binder.place(instance(1), 1_000);
    expect(placed.ok).toBe(false);
    expect(port.calls).toEqual([]);
    expect(host.instanceCount).toBe(1);
  });

  it('refuses to place the same instance twice', async () => {
    const { binder } = scenario();
    await binder.place(instance(1), 1_000);

    const again = await binder.place(instance(1), 1_000);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('host');
  });
});

describe('reportPainted', () => {
  it('refuses an instance that was never placed', async () => {
    const { binder } = scenario();
    const painted = await binder.reportPainted(instance(1));

    expect(painted.ok).toBe(false);
    if (!painted.ok) expect(painted.error.kind).toBe('host');
  });
});

describe('moveToNewSurface', () => {
  it('releases the old surface before asking for a new one', async () => {
    // Acquiring first would leave two surfaces for one widget if the second step
    // failed, and the extra one would be a hidden window nothing refers to.
    const { binder, port } = scenario();
    await binder.place(instance(1), 1_000);
    port.calls.length = 0;

    const moved = await binder.moveToNewSurface(instance(1), 2_000);
    expect(moved.ok).toBe(true);

    expect(port.calls).toEqual([
      'release:devdesk.clock#1',
      'acquire:devdesk.clock#1',
    ]);
    expect(port.live.size).toBe(1);
  });

  it('leaves the widget running on the new surface', async () => {
    const { host, binder } = scenario();
    await binder.place(instance(1), 1_000);

    const moved = await binder.moveToNewSurface(instance(1), 2_000);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.phase).toBe('running');
      expect(moved.value.surfaceId).toBe('devdesk.clock#1/2');
    }
    expect(host.contextOf(instance(1))?.surfaceId).toBe('devdesk.clock#1/2');
  });

  it('refuses to move something that is not placed', async () => {
    const { binder } = scenario();
    expect((await binder.moveToNewSurface(instance(1), 2_000)).ok).toBe(false);
  });
});

describe('remove', () => {
  it('destroys the widget and releases its surface', async () => {
    const { host, binder, port } = scenario();
    await binder.place(instance(1), 1_000);

    const removed = await binder.remove(instance(1));
    expect(removed.ok).toBe(true);
    expect(host.instanceCount).toBe(0);
    expect(port.live.size).toBe(0);
  });

  it('destroys the widget even when the core will not release the surface', async () => {
    // Same reason the core removes a surface whether or not its window could be
    // destroyed: keeping it would resurrect it on the next arrangement restore.
    const { host, binder, port } = scenario();
    await binder.place(instance(1), 1_000);
    port.failRelease = true;

    const removed = await binder.remove(instance(1));
    expect(removed.ok).toBe(true);
    expect(host.instanceCount).toBe(0);
  });

  it('removes a widget that was created but never placed', async () => {
    const { host, binder, port } = scenario();
    host.create(instance(1));

    const removed = await binder.remove(instance(1));
    expect(removed.ok).toBe(true);
    expect(host.instanceCount).toBe(0);
    expect(port.calls).toEqual([]);
  });

  it('reports an unknown instance', async () => {
    const { binder } = scenario();
    expect((await binder.remove(instance(9))).ok).toBe(false);
  });
});

describe('describeBindingError', () => {
  it('says something actionable for a port failure', async () => {
    const { binder, port } = scenario();
    port.failAcquire = true;

    const placed = await binder.place(instance(1), 1_000);
    expect(placed.ok).toBe(false);
    if (placed.ok) return;

    const described = describeBindingError(placed.error, describeHostError);
    expect(described).toContain('refused');
    expect(described).not.toContain('undefined');
  });

  it('delegates a host failure to the host describer', async () => {
    const { binder } = scenario();
    const painted = await binder.reportPainted(instance(1));
    expect(painted.ok).toBe(false);
    if (painted.ok) return;

    expect(describeBindingError(painted.error, describeHostError)).toContain('instance');
  });
});
