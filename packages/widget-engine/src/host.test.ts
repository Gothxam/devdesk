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
import { everyMs, NO_CADENCE, type WidgetDefinition, type WidgetUpdate } from './definition';
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

const MANIFEST = {
  id: CLOCK,
  name: 'Clock',
  version: '1.0.0',
  description: 'The time.',
  capabilities: [],
  preferredSize: { width: 240, height: 120 },
};

/** What a probe remembers: the last update it was given. */
interface ProbeState {
  readonly at: number;
  readonly updates: number;
}

/** What a probe shows: enough to see the context and the state. */
interface ProbeView {
  readonly theme: string;
  readonly monitor: string | undefined;
  readonly at: number;
  readonly updates: number;
}

interface Probe extends WidgetDefinition<ProbeState, ProbeView> {
  readonly seen: () => readonly WidgetUpdate[];
  readonly contexts: () => readonly WidgetContext[];
}

function probe(onInitialize?: (context: WidgetContext) => void): Probe {
  const seen: WidgetUpdate[] = [];
  const contexts: WidgetContext[] = [];

  return Object.freeze({
    id: id(CLOCK),
    cadence: everyMs(1_000),

    initialize(context: WidgetContext, at: number): ProbeState {
      onInitialize?.(context);
      contexts.push(context);
      return { at, updates: 0 };
    },

    update(state: ProbeState, update: WidgetUpdate): ProbeState {
      seen.push(update);
      return { at: update.at, updates: state.updates + 1 };
    },

    render(state: ProbeState, context: WidgetContext): ProbeView {
      return {
        theme: context.theme.metadata.mode,
        monitor: context.monitorId,
        at: state.at,
        updates: state.updates,
      };
    },

    seen: () => seen,
    contexts: () => contexts,
  });
}

function host(definition?: WidgetDefinition<ProbeState, ProbeView>) {
  const registered = createWidgetRegistry().register(MANIFEST);
  if (!registered.ok) throw new Error('fixture');

  const created = new WidgetHost<ProbeState, ProbeView>(registered.value, fallbackSnapshot('dark'));
  if (definition) {
    const defined = created.define(definition);
    if (!defined.ok) throw new Error('fixture');
  }
  return created;
}

const PLACEMENT = { surfaceId: surface('surface-1'), monitorId: monitor('unit:SN-LAPTOP') };
const T0 = 1_000;

// ----------------------------------------------------------------- tests --

describe('define', () => {
  it('refuses code for a widget that is not registered', () => {
    const bare = new WidgetHost<ProbeState, ProbeView>(
      createWidgetRegistry(),
      fallbackSnapshot('dark'),
    );

    const defined = bare.define(probe());
    expect(defined.ok).toBe(false);
    if (!defined.ok) expect(defined.error.kind).toBe('unknown-widget');
  });
});

describe('create', () => {
  it('builds an instance with no surface, no context, and no state', () => {
    const runtime = host(probe());
    const created = runtime.create(instance(CLOCK, 1));

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.phase).toBe('created');
    expect(created.value.surfaceId).toBeUndefined();
    expect(runtime.stateOf(instance(CLOCK, 1))).toBeUndefined();
  });

  it('refuses an instance of an unregistered widget', () => {
    const runtime = host(probe());
    const created = runtime.create(instance('com.acme.weather', 1));

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.kind).toBe('unknown-widget');
  });

  it('refuses a widget the host has no code for', () => {
    // Registered is data; defined is code. They arrive from different places,
    // and in M3 from different processes.
    const created = host().create(instance(CLOCK, 1));

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.kind).toBe('no-definition');
  });

  it('refuses a duplicate instance identity', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));

    const again = runtime.create(instance(CLOCK, 1));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('already-created');
  });

  it('does not initialise the widget until it has somewhere to be', () => {
    const built = vi.fn();
    const runtime = host(probe(built));
    runtime.create(instance(CLOCK, 1));

    expect(built).not.toHaveBeenCalled();
  });
});

describe('attach', () => {
  it('initialises the widget with a complete context and the runtime clock', () => {
    const definition = probe();
    const runtime = host(definition);
    runtime.create(instance(CLOCK, 1));

    const attached = runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;

    expect(attached.value.phase).toBe('attached');
    expect(attached.value.surfaceId).toBe('surface-1');
    expect(runtime.stateOf(instance(CLOCK, 1))).toEqual({ at: T0, updates: 0 });

    const context = definition.contexts()[0];
    expect(context?.monitorId).toBe('unit:SN-LAPTOP');
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('gives the widget no way to reach the host', () => {
    // The restriction is structural: the three functions receive a context, a
    // state, and an update. None of them can open a window or find another
    // widget.
    const definition = probe();
    const runtime = host(definition);
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);

    expect(Object.keys(definition.contexts()[0] ?? {}).sort()).toEqual([
      'events',
      'instanceId',
      'monitorId',
      'surfaceId',
      'theme',
      'widgetId',
    ]);
  });

  it('marks the instance dirty so its first update runs', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);

    expect(runtime.isDirty(instance(CLOCK, 1))).toBe(true);
    expect(runtime.pendingReasons(instance(CLOCK, 1))).toEqual(['attached']);
  });

  it('attaches with no display, which is a real state', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));

    const attached = runtime.attach(
      instance(CLOCK, 1),
      { surfaceId: surface('surface-1'), monitorId: undefined },
      T0,
    );

    expect(attached.ok).toBe(true);
    if (attached.ok) expect(attached.value.monitorId).toBeUndefined();
  });

  it('refuses to attach twice', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);

    expect(runtime.attach(instance(CLOCK, 1), PLACEMENT, T0).ok).toBe(false);
  });

  it('refuses an unknown instance', () => {
    const attached = host(probe()).attach(instance(CLOCK, 9), PLACEMENT, T0);
    expect(attached.ok).toBe(false);
    if (!attached.ok) expect(attached.error.kind).toBe('unknown-instance');
  });
});

describe('flush', () => {
  function attached() {
    const definition = probe();
    const runtime = host(definition);
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);
    return { runtime, definition, target: instance(CLOCK, 1) };
  }

  it('runs the widget with everything it owes, coalesced into one call', () => {
    // Three causes landing before the flush become one update. A host that
    // applied each as it arrived would have run the widget three times.
    const { runtime, definition, target } = attached();
    runtime.markDirty(target, 'interval');
    runtime.markDirty(target, 'requested');

    const flushed = runtime.flush(target, T0 + 500);
    expect(flushed.ok).toBe(true);
    if (flushed.ok) {
      expect(flushed.value.changed).toBe(true);
      expect(flushed.value.reasons).toEqual(['attached', 'interval', 'requested']);
    }

    expect(definition.seen()).toHaveLength(1);
    expect(definition.seen()[0]?.at).toBe(T0 + 500);
  });

  it('reports reasons in a canonical order, whatever order they arrived in', () => {
    const { runtime, target } = attached();
    runtime.flush(target, T0);

    runtime.markDirty(target, 'requested');
    runtime.markDirty(target, 'theme-changed');
    runtime.markDirty(target, 'interval');

    const flushed = runtime.flush(target, T0 + 1);
    if (flushed.ok) {
      expect(flushed.value.reasons).toEqual(['theme-changed', 'interval', 'requested']);
    }
  });

  it('deduplicates a cause raised twice', () => {
    const { runtime, target } = attached();
    runtime.flush(target, T0);

    runtime.markDirty(target, 'interval');
    runtime.markDirty(target, 'interval');

    const flushed = runtime.flush(target, T0 + 1);
    if (flushed.ok) expect(flushed.value.reasons).toEqual(['interval']);
  });

  it('does nothing when nothing is owed', () => {
    // The common case for a widget with no cadence on a desktop nobody is
    // touching, and the reason B-4's idle budget is reachable.
    const { runtime, definition, target } = attached();
    runtime.flush(target, T0);

    const again = runtime.flush(target, T0 + 1);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.value.changed).toBe(false);
      expect(again.value.reasons).toEqual([]);
    }
    expect(definition.seen()).toHaveLength(1);
  });

  it('clears what it owes, so a second flush is a no-op', () => {
    const { runtime, target } = attached();
    runtime.flush(target, T0);

    expect(runtime.isDirty(target)).toBe(false);
  });

  it('reports that nothing changed when the widget returns its own state', () => {
    // Returning the same object is how a widget tells the runtime to skip the
    // render.
    const registered = createWidgetRegistry().register(MANIFEST);
    if (!registered.ok) throw new Error('fixture');

    const runtime = new WidgetHost<ProbeState, ProbeView>(
      registered.value,
      fallbackSnapshot('dark'),
    );
    runtime.define({
      id: id(CLOCK),
      cadence: NO_CADENCE,
      initialize: (_context, at) => ({ at, updates: 0 }),
      update: (state) => state,
      render: (state, context) => ({
        theme: context.theme.metadata.mode,
        monitor: context.monitorId,
        at: state.at,
        updates: state.updates,
      }),
    });

    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);

    const flushed = runtime.flush(instance(CLOCK, 1), T0 + 1);
    expect(flushed.ok && flushed.value.changed).toBe(false);
  });

  it('refuses an instance with no surface', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));

    const flushed = runtime.flush(instance(CLOCK, 1), T0);
    expect(flushed.ok).toBe(false);
    if (!flushed.ok) expect(flushed.error.kind).toBe('not-attached');
  });

  it('does not mark a detached instance dirty', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));

    runtime.markDirty(instance(CLOCK, 1), 'interval');
    expect(runtime.isDirty(instance(CLOCK, 1))).toBe(false);
  });
});

describe('render', () => {
  it('renders the state as it stands, without flushing first', () => {
    // Rendering is a read. A read that silently ran the widget would make two
    // calls describing one moment disagree.
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);
    runtime.markDirty(instance(CLOCK, 1), 'interval');

    const view = runtime.render(instance(CLOCK, 1));
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.value.updates).toBe(0);
    expect(runtime.isDirty(instance(CLOCK, 1))).toBe(true);
  });

  it('refuses to render something with no surface', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    expect(runtime.render(instance(CLOCK, 1)).ok).toBe(false);
  });

  it('is pure: two renders of one state agree', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    runtime.attach(instance(CLOCK, 1), PLACEMENT, T0);

    const first = runtime.render(instance(CLOCK, 1));
    const second = runtime.render(instance(CLOCK, 1));
    expect(first.ok && second.ok && first.value).toEqual(second.ok ? second.value : undefined);
  });
});

describe('start, suspend, resume', () => {
  function running() {
    const runtime = host(probe());
    const target = instance(CLOCK, 1);
    runtime.create(target);
    runtime.attach(target, PLACEMENT, T0);
    runtime.flush(target, T0);
    runtime.start(target);
    return { runtime, target };
  }

  it('runs the ordinary sequence', () => {
    const { runtime, target } = running();
    expect(runtime.snapshot(target)?.phase).toBe('running');
    expect(runtime.suspend(target).ok && runtime.snapshot(target)?.phase).toBe('suspended');
    expect(runtime.resume(target).ok && runtime.snapshot(target)?.phase).toBe('running');
  });

  it('marks a resumed instance dirty, because time passed while it was not updating', () => {
    const { runtime, target } = running();
    runtime.suspend(target);
    expect(runtime.isDirty(target)).toBe(false);

    runtime.resume(target);
    expect(runtime.pendingReasons(target)).toEqual(['resumed']);
  });

  it('tells the widget through its own channel', () => {
    const heard: string[] = [];
    const runtime = host(
      probe((context) => {
        context.events.subscribe((event) => heard.push(event.kind));
      }),
    );

    const target = instance(CLOCK, 1);
    runtime.create(target);
    runtime.attach(target, PLACEMENT, T0);
    runtime.start(target);
    runtime.suspend(target);
    runtime.resume(target);

    expect(heard).toEqual(['suspended', 'resumed']);
  });

  it('refuses to start something that is not attached', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    expect(runtime.start(instance(CLOCK, 1)).ok).toBe(false);
  });
});

describe('detach', () => {
  it('returns the instance to created and discards its state', () => {
    // The state was computed against a surface that is no longer this
    // instance's. Keeping it would mean resuming with figures derived elsewhere.
    const runtime = host(probe());
    const target = instance(CLOCK, 1);

    runtime.create(target);
    runtime.attach(target, PLACEMENT, T0);
    runtime.start(target);

    const detached = runtime.detach(target);
    expect(detached.ok).toBe(true);
    if (detached.ok) expect(detached.value.phase).toBe('created');

    expect(runtime.stateOf(target)).toBeUndefined();
    expect(runtime.isDirty(target)).toBe(false);
    expect(runtime.render(target).ok).toBe(false);
  });

  it('is how a widget moves between surfaces', () => {
    const runtime = host(probe());
    const target = instance(CLOCK, 1);

    runtime.create(target);
    runtime.attach(target, PLACEMENT, T0);
    runtime.start(target);
    runtime.detach(target);

    const moved = runtime.attach(
      target,
      { surfaceId: surface('surface-2'), monitorId: monitor('unit:SN-EXTERNAL') },
      T0 + 100,
    );

    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.value.surfaceId).toBe('surface-2');
    expect(runtime.stateOf(target)).toEqual({ at: T0 + 100, updates: 0 });
  });
});

describe('destroy', () => {
  it('releases the instance', () => {
    const runtime = host(probe());
    const target = instance(CLOCK, 1);

    runtime.create(target);
    runtime.attach(target, PLACEMENT, T0);
    runtime.start(target);

    expect(runtime.destroy(target).ok).toBe(true);
    expect(runtime.instanceCount).toBe(0);
    expect(runtime.snapshot(target)).toBeUndefined();
  });

  it('refuses a second destroy', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));
    runtime.destroy(instance(CLOCK, 1));

    const again = runtime.destroy(instance(CLOCK, 1));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe('unknown-instance');
  });

  it('destroys every instance in a fixed order', () => {
    const runtime = host(probe());
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

describe('snapshot', () => {
  it('reports the declared cadence, so a scheduler need not hold definitions', () => {
    const runtime = host(probe());
    runtime.create(instance(CLOCK, 1));

    expect(runtime.snapshot(instance(CLOCK, 1))?.cadence).toEqual({
      kind: 'interval',
      everyMs: 1_000,
    });
  });
});

describe('describeHostError', () => {
  it('says something actionable for every failure', () => {
    const runtime = host();
    const failures = [
      runtime.create(instance(CLOCK, 1)),
      runtime.attach(instance(CLOCK, 5), PLACEMENT, T0),
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
