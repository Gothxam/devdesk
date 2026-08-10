import { describe, expect, it } from 'vitest';

import {
  accepts,
  createLifecycle,
  describeLifecycleError,
  hasSurface,
  isUpdating,
  lifecycleAt,
  nextPhase,
  WIDGET_LIFECYCLE_EVENTS,
  WIDGET_PHASES,
  type WidgetLifecycleEvent,
  type WidgetPhase,
} from './lifecycle';

/** Walks a lifecycle through a sequence, asserting each step is accepted. */
function walk(events: readonly WidgetLifecycleEvent[]) {
  let lifecycle = createLifecycle();
  for (const event of events) {
    const result = lifecycle.apply(event);
    if (!result.ok) throw new Error(`"${event}" refused from "${lifecycle.phase}"`);
    lifecycle = result.value;
  }
  return lifecycle;
}

describe('the happy path', () => {
  it('runs registered → created → attached → running', () => {
    expect(createLifecycle().phase).toBe('registered');
    expect(walk(['create']).phase).toBe('created');
    expect(walk(['create', 'attach']).phase).toBe('attached');
    expect(walk(['create', 'attach', 'start']).phase).toBe('running');
  });

  it('suspends and resumes', () => {
    expect(walk(['create', 'attach', 'start', 'suspend']).phase).toBe('suspended');
    expect(walk(['create', 'attach', 'start', 'suspend', 'resume']).phase).toBe('running');
  });

  it('destroys from every phase that is not already destroyed', () => {
    for (const phase of WIDGET_PHASES) {
      const result = lifecycleAt(phase).apply('destroy');
      if (phase === 'destroyed') expect(result.ok, phase).toBe(false);
      else {
        expect(result.ok, phase).toBe(true);
        if (result.ok) expect(result.value.phase).toBe('destroyed');
      }
    }
  });
});

describe('determinism', () => {
  it('gives one answer for every phase and event, always', () => {
    // 6 phases × 7 events = 42 cases, each evaluated twice. The machine depends
    // on nothing outside its two inputs, so the second answer must equal the
    // first.
    for (const phase of WIDGET_PHASES) {
      for (const event of WIDGET_LIFECYCLE_EVENTS) {
        const first = nextPhase(phase, event);
        const second = nextPhase(phase, event);
        expect(JSON.stringify(first), `${phase}/${event}`).toBe(JSON.stringify(second));
      }
    }
  });

  it('agrees with what it says it accepts', () => {
    for (const phase of WIDGET_PHASES) {
      for (const event of WIDGET_LIFECYCLE_EVENTS) {
        expect(accepts(phase, event), `${phase}/${event}`).toBe(nextPhase(phase, event).ok);
        expect(lifecycleAt(phase).accepts(event)).toBe(accepts(phase, event));
      }
    }
  });

  it('never mutates the lifecycle an event was applied to', () => {
    const created = walk(['create']);
    const attached = created.apply('attach');

    expect(created.phase).toBe('created');
    expect(attached.ok && attached.value.phase).toBe('attached');
  });

  it('reaches every phase from the start', () => {
    // A phase nothing can reach is dead code pretending to be a state.
    const reached = new Set<WidgetPhase>(['registered']);
    const frontier: WidgetPhase[] = ['registered'];

    while (frontier.length > 0) {
      const phase = frontier.pop();
      if (phase === undefined) break;
      for (const event of WIDGET_LIFECYCLE_EVENTS) {
        const next = nextPhase(phase, event);
        if (next.ok && !reached.has(next.value)) {
          reached.add(next.value);
          frontier.push(next.value);
        }
      }
    }

    expect([...reached].sort()).toEqual([...WIDGET_PHASES].sort());
  });
});

describe('illegal transitions', () => {
  it('refuses running before attaching', () => {
    expect(lifecycleAt('registered').apply('start').ok).toBe(false);
    expect(lifecycleAt('created').apply('start').ok).toBe(false);
  });

  it('refuses attaching twice', () => {
    // There is no direct move between surfaces. Allowing one would let a caller
    // believe a widget was on two surfaces at once.
    expect(lifecycleAt('attached').apply('attach').ok).toBe(false);
    expect(lifecycleAt('running').apply('attach').ok).toBe(false);
  });

  it('refuses resuming something that is not suspended', () => {
    for (const phase of ['registered', 'created', 'attached', 'running'] as const) {
      expect(lifecycleAt(phase).apply('resume').ok, phase).toBe(false);
    }
  });

  it('refuses suspending something that is not running', () => {
    for (const phase of ['registered', 'created', 'attached', 'suspended'] as const) {
      expect(lifecycleAt(phase).apply('suspend').ok, phase).toBe(false);
    }
  });

  it('refuses every event once destroyed', () => {
    // Terminal means terminal. A second teardown is a caller's bug, and hiding
    // it means the bug surfaces somewhere further away — the same call the
    // window subsystem made for surface removal.
    const destroyed = lifecycleAt('destroyed');
    expect(destroyed.isTerminal).toBe(true);
    for (const event of WIDGET_LIFECYCLE_EVENTS) {
      expect(destroyed.apply(event).ok, event).toBe(false);
    }
  });

  it('reports what was refused and what would have been accepted', () => {
    const refused = lifecycleAt('created').apply('start');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;

    expect(refused.error).toEqual({ kind: 'illegal-transition', from: 'created', event: 'start' });

    const described = describeLifecycleError(refused.error);
    expect(described).toContain('start');
    expect(described).toContain('created');
    expect(described).toContain('attach');
  });
});

describe('detach', () => {
  it('returns a widget to created, from any phase that has a surface', () => {
    for (const phase of ['attached', 'running', 'suspended'] as const) {
      const detached = lifecycleAt(phase).apply('detach');
      expect(detached.ok, phase).toBe(true);
      if (detached.ok) expect(detached.value.phase).toBe('created');
    }
  });

  it('is refused where there is no surface', () => {
    expect(lifecycleAt('registered').apply('detach').ok).toBe(false);
    expect(lifecycleAt('created').apply('detach').ok).toBe(false);
  });

  it('is how a widget moves between surfaces', () => {
    // Detach, then attach elsewhere. The moment in between, where it has no
    // surface, is real and the machine says so.
    const moved = walk(['create', 'attach', 'start', 'detach', 'attach', 'start']);
    expect(moved.phase).toBe('running');
  });

  it('stops a running widget, because there is nothing left to update into', () => {
    const detached = lifecycleAt('running').apply('detach');
    expect(detached.ok && isUpdating(detached.value.phase)).toBe(false);
  });
});

describe('phase predicates', () => {
  it('says which phases hold a surface', () => {
    expect(WIDGET_PHASES.filter(hasSurface)).toEqual(['attached', 'running', 'suspended']);
  });

  it('says which phases update', () => {
    expect(WIDGET_PHASES.filter(isUpdating)).toEqual(['running']);
  });

  it('agrees with the machine: a widget with a surface can always detach', () => {
    for (const phase of WIDGET_PHASES) {
      expect(accepts(phase, 'detach'), phase).toBe(hasSurface(phase));
    }
  });
});
