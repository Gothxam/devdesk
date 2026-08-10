import {
  monitorId,
  surfaceId,
  widgetId,
  widgetInstanceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import { describe, expect, it, vi } from 'vitest';

import type { WidgetContext } from './context';
import type { WidgetDefinition } from './definition';
import { describeHostError, WidgetHost } from './host';
import { createWidgetRegistry } from './registry';

// ------------------------------------------------------------- fixtures --

const CLOCK = 'devdesk.clock';

function id(value: string) {
  const parsed = widgetId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function instance(value: string, ordinal: number): WidgetInstanceId {
  const parsed = widgetInstanceId(id(value), ordinal);
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

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: CLOCK,
    name: 'Clock',
    version: '1.0.0',
    description: 'The time.',
    capabilities: [],
    preferredSize: { width: 240, height: 120 },
    ...overrides,
  };
}

/** A widget whose view is whatever it was last told, so tests can read it. */
interface ProbeView {
  readonly theme: string;
  readonly monitor: string | undefined;
  readonly renders: number;
}

function probeDefinition(
  onCreate?: (context: WidgetContext) => void,
): WidgetDefinition<ProbeView> & { destroyed: () => number } {
  let destroyed = 0;

  const definition: WidgetDefinition<ProbeView> = {
    id: id(CLOCK),
    create(context) {
      onCreate?.(context);
      let renders = 0;
      return {
        render(current) {
          renders += 1;
          return {
            theme: current.theme.metadata.themeId,
            monitor: current.monitorId,
            renders,
          };
        },
        destroy() {
          destroyed += 1;
        },
      };
    },
  };

  return Object.assign(definition, { destroyed: () => destroyed });
}

function host(definition?: WidgetDefinition<ProbeView>) {
  const registered = createWidgetRegistry().register(manifest());
  if (!registered.ok) throw new Error('fixture');

  const created = new WidgetHost<ProbeView>(registered.value, fallbackSnapshot('dark'));
  if (definition) {
    const defined = created.define(definition);
    if (!defined.ok) throw new Error('fixture');
  }
  return created;
}

const PLACEMENT = { surfaceId: surface('surface-1'), monitorId: monitor('unit:SN-LAPTOP') };

// ----------------------------------------------------------------- tests --

describe('define', () => {
  it('refuses code for a widget that is not registered', () => {
    const registry = createWidgetRegistry();
    const bare = new WidgetHost<ProbeView>(registry, fallbackSnapshot('dark'));

    const defined = bare.define(probeDefinition());
    expect(defined.ok).toBe(false);
    if (!defined.ok) expect(defined.error.kind).toBe('unknown-widget');
  });
});

describe('create', () => {
  it('builds an instance with no surface and no context', () => {
    const runtime = host(probeDefinition());
    const created = runtime.create(instance(CLOCK, 1));

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.phase).toBe('created');
    expect(created.value.surfaceId).toBeUndefined();
    expect(runtime.instanceCount).toBe(1);
  });

  it('refuses an instance of an unregistered widget', () => {
    const runtime = host(probeDefinition());
    const created = runtime.create(instance('com.acme.weather', 1));

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.kind).toBe('unknown-widget');
  });

  it('refuses a widget the host has no code for', () => {
    // Registered is data; defined is code. They arrive from different places,
    // and in M3 from different processes.
    const runtime = host();
    const created = runtime.create(instance(CLOCK, 1));

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.kind).toBe('no-definition');
  });

  it('refuses a duplicate instance identity', () => {
    const runtime = host(probeDefinition());
    runtime.create(instance(CLOCK, 1));

    const again = runtime.create(instance(CLOCK, 1));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('already-created');
  });

  it('does not build the widget until it has somewhere to be', () => {
    // Building earlier would hand it a context missing the surface it is about
    // to be told to render into.
    const built = vi.fn();
    const runtime = host(probeDefinition(built));
    runtime.create(instance(CLOCK, 1));

    expect(built).not.toHaveBeenCalled();
  });
});

describe('attach', () => {
  it('builds the widget with a complete context', () => {
    let seen: WidgetContext | undefined;
    const runtime = host(probeDefinition((context) => (seen = context)));
    runtime.create(instance(CLOCK, 1));

    const attached = runtime.attach(instance(CLOCK, 1), PLACEMENT);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;

    expect(attached.value.phase).toBe('attached');
    expect(attached.value.surfaceId).toBe('surface-1');
    expect(seen?.surfaceId).toBe('surface-1');
    expect(seen?.monitorId).toBe('unit:SN-LAPTOP');
    expect(seen?.instanceId).toBe('devdesk.clock#1');
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it('gives the widget no way to reach the host', () => {
    // The restriction is structural: create receives a context and nothing
    // else, and the context holds identity, placement, theme, and an event
    // channel. Nothing on it can open a window or find another widget.
    let seen: WidgetContext | undefined;
    const runtime = host(probeDefinition((context) => (seen = context)));
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT);

    expect(Object.keys(seen ?? {}).sort()).toEqual([
      'events',
      'instanceId',
      'monitorId',
      'surfaceId',
      'theme',
      'widgetId',
    ]);
  });

  it('attaches with no display, which is a real state', () => {
    const runtime = host(probeDefinition());
    runtime.create(instance(CLOCK, 1));

    const attached = runtime.attach(instance(CLOCK, 1), {
      surfaceId: surface('surface-1'),
      monitorId: undefined,
    });

    expect(attached.ok).toBe(true);
    if (attached.ok) expect(attached.value.monitorId).toBeUndefined();
  });

  it('refuses to attach twice', () => {
    const runtime = host(probeDefinition());
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT);

    const again = runtime.attach(instance(CLOCK, 1), PLACEMENT);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('lifecycle');
  });

  it('refuses an unknown instance', () => {
    const runtime = host(probeDefinition());
    const attached = runtime.attach(instance(CLOCK, 9), PLACEMENT);

    expect(attached.ok).toBe(false);
    if (!attached.ok) expect(attached.error.kind).toBe('unknown-instance');
  });
});

describe('render', () => {
  it('produces a view from the context', () => {
    const runtime = host(probeDefinition());
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT);

    const view = runtime.render(instance(CLOCK, 1));
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.value.monitor).toBe('unit:SN-LAPTOP');
  });

  it('refuses to render something with no surface', () => {
    const runtime = host(probeDefinition());
    runtime.create(instance(CLOCK, 1));

    expect(runtime.render(instance(CLOCK, 1)).ok).toBe(false);
  });
});

describe('start, suspend, resume', () => {
  it('runs the ordinary sequence', () => {
    const runtime = host(probeDefinition());
    const target = instance(CLOCK, 1);
    runtime.create(target);
    runtime.attach(target, PLACEMENT);

    expect(runtime.start(target).ok && runtime.snapshot(target)?.phase).toBe('running');
    expect(runtime.suspend(target).ok && runtime.snapshot(target)?.phase).toBe('suspended');
    expect(runtime.resume(target).ok && runtime.snapshot(target)?.phase).toBe('running');
  });

  it('tells the widget when it is suspended and resumed', () => {
    // A widget hears through the channel on its own context, and through no
    // other route: there is no shared bus to subscribe to.
    const heard: string[] = [];
    const runtime = host(
      probeDefinition((context) => {
        context.events.subscribe((event) => heard.push(event.kind));
      }),
    );

    const target = instance(CLOCK, 1);
    runtime.create(target);
    runtime.attach(target, PLACEMENT);
    runtime.start(target);

    expect(heard).toEqual([]);

    runtime.suspend(target);
    runtime.resume(target);

    expect(heard).toEqual(['suspended', 'resumed']);
  });

  it('does not announce a transition the machine refused', () => {
    const heard: string[] = [];
    const runtime = host(
      probeDefinition((context) => {
        context.events.subscribe((event) => heard.push(event.kind));
      }),
    );

    const target = instance(CLOCK, 1);
    runtime.create(target);
    runtime.attach(target, PLACEMENT);

    // Suspending something that is not running is refused, and nothing is said.
    expect(runtime.suspend(target).ok).toBe(false);
    expect(heard).toEqual([]);
  });

  it('refuses to start something that is not attached', () => {
    const runtime = host(probeDefinition());
    runtime.create(instance(CLOCK, 1));
    expect(runtime.start(instance(CLOCK, 1)).ok).toBe(false);
  });
});

describe('detach', () => {
  it('returns the instance to created and discards the widget', () => {
    // The widget was built against a context naming a surface that is no longer
    // this instance's. Reusing it would mean rendering for somewhere it is not.
    const definition = probeDefinition();
    const runtime = host(definition);
    const target = instance(CLOCK, 1);

    runtime.create(target);
    runtime.attach(target, PLACEMENT);
    runtime.start(target);

    const detached = runtime.detach(target);
    expect(detached.ok).toBe(true);
    if (detached.ok) {
      expect(detached.value.phase).toBe('created');
      expect(detached.value.surfaceId).toBeUndefined();
    }
    expect(definition.destroyed()).toBe(1);
    expect(runtime.render(target).ok).toBe(false);
  });

  it('is how a widget moves between surfaces', () => {
    const runtime = host(probeDefinition());
    const target = instance(CLOCK, 1);

    runtime.create(target);
    runtime.attach(target, PLACEMENT);
    runtime.start(target);
    runtime.detach(target);

    const moved = runtime.attach(target, {
      surfaceId: surface('surface-2'),
      monitorId: monitor('unit:SN-EXTERNAL'),
    });

    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.value.surfaceId).toBe('surface-2');
    expect(runtime.start(target).ok).toBe(true);
  });
});

describe('destroy', () => {
  it('releases the instance and its channel', () => {
    const definition = probeDefinition();
    const runtime = host(definition);
    const target = instance(CLOCK, 1);

    runtime.create(target);
    runtime.attach(target, PLACEMENT);
    runtime.start(target);

    expect(runtime.destroy(target).ok).toBe(true);
    expect(runtime.instanceCount).toBe(0);
    expect(runtime.snapshot(target)).toBeUndefined();
    expect(definition.destroyed()).toBe(1);
  });

  it('refuses a second destroy', () => {
    const runtime = host(probeDefinition());
    const target = instance(CLOCK, 1);
    runtime.create(target);
    runtime.destroy(target);

    const again = runtime.destroy(target);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('unknown-instance');
  });

  it('destroys every instance in a fixed order', () => {
    const runtime = host(probeDefinition());
    for (const ordinal of [3, 1, 2]) runtime.create(instance(CLOCK, ordinal));

    expect(runtime.instances().map((entry) => entry.instanceId)).toEqual([
      'devdesk.clock#1',
      'devdesk.clock#2',
      'devdesk.clock#3',
    ]);

    runtime.destroyAll();
    expect(runtime.instanceCount).toBe(0);
  });
});

describe('describeHostError', () => {
  it('says something actionable for every failure', () => {
    const runtime = host();
    const failures = [
      runtime.create(instance(CLOCK, 1)),
      runtime.attach(instance(CLOCK, 5), PLACEMENT),
    ];

    for (const failure of failures) {
      expect(failure.ok).toBe(false);
      if (failure.ok) continue;
      const described = describeHostError(failure.error);
      expect(described.length).toBeGreaterThan(0);
      expect(described).not.toContain('undefined');
    }
  });
});
