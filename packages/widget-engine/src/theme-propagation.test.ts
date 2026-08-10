import {
  monitorId,
  surfaceId,
  widgetId,
  widgetInstanceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import { fallbackSnapshot, type ThemeSnapshot } from '@devdesk/theme-engine';
import { describe, expect, it } from 'vitest';

import type { WidgetContext } from './context';
import { NO_CADENCE, type WidgetDefinition } from './definition';
import type { WidgetEvent } from './events';
import { WidgetHost } from './host';
import { createWidgetRegistry } from './registry';

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

/** What a probe widget saw, in order. */
interface Journal {
  readonly events: WidgetEvent[];
  readonly themesAtRender: string[];
  readonly contexts: WidgetContext[];
}

function probe(journal: Journal): WidgetDefinition<number, string> {
  return {
    id: id(CLOCK),
    cadence: NO_CADENCE,
    initialize(context) {
      journal.contexts.push(context);
      context.events.subscribe((event) => journal.events.push(event));
      return 0;
    },
    update: (state) => state + 1,
    render(_state, context) {
      journal.themesAtRender.push(context.theme.metadata.mode);
      return context.theme.metadata.mode;
    },
  };
}

function scenario(theme: ThemeSnapshot = fallbackSnapshot('dark')) {
  const registered = createWidgetRegistry().register(MANIFEST);
  if (!registered.ok) throw new Error('fixture');

  const journal: Journal = { events: [], themesAtRender: [], contexts: [] };
  const host = new WidgetHost<number, string>(registered.value, theme);
  const defined = host.define(probe(journal));
  if (!defined.ok) throw new Error('fixture');

  return { host, journal };
}

function attachRunning(
  host: WidgetHost<number, string>,
  ordinal: number,
  display = 'unit:SN-LAPTOP',
) {
  host.create(instance(ordinal));
  host.attach(
    instance(ordinal),
    { surfaceId: surface(`surface-${ordinal}`), monitorId: monitor(display) },
    1_000,
  );
  host.start(instance(ordinal));
}

describe('applyTheme', () => {
  it('gives every attached widget the new snapshot', () => {
    const { host, journal } = scenario();
    attachRunning(host, 1);

    host.applyTheme(fallbackSnapshot('light'));

    const view = host.render(instance(1));
    expect(view.ok && view.value).toBe('light');
    expect(host.contextOf(instance(1))?.theme.metadata.mode).toBe('light');
    expect(journal.events.filter((event) => event.kind === 'theme-changed')).toHaveLength(1);
  });

  it('replaces the context rather than mutating it', () => {
    // A widget holding the context it last rendered can compare identity to
    // know something moved.
    const { host, journal } = scenario();
    attachRunning(host, 1);

    const before = host.contextOf(instance(1));
    host.applyTheme(fallbackSnapshot('light'));
    const after = host.contextOf(instance(1));

    expect(after).not.toBe(before);
    expect(before?.theme.metadata.mode).toBe('dark');
    expect(Object.isFrozen(after)).toBe(true);
    expect(journal.contexts[0]?.theme.metadata.mode).toBe('dark');
  });

  it('switches every widget to one snapshot, never a mixture', () => {
    // AC-THM-3.1. There is no moment where half the desktop reads the old theme.
    const { host } = scenario();
    for (const ordinal of [1, 2, 3]) attachRunning(host, ordinal);

    host.applyTheme(fallbackSnapshot('light'));

    const modes = [1, 2, 3].map((ordinal) => host.contextOf(instance(ordinal))?.theme.hash);
    expect(new Set(modes).size).toBe(1);
  });

  it('tells suspended widgets too', () => {
    // Skipping them would leave one holding the previous theme, so resuming it
    // would repaint in the old colours — a flash on the path that exists to
    // avoid one.
    const { host } = scenario();
    attachRunning(host, 1);
    host.suspend(instance(1));

    host.applyTheme(fallbackSnapshot('light'));

    expect(host.contextOf(instance(1))?.theme.metadata.mode).toBe('light');
    expect(host.resume(instance(1)).ok).toBe(true);
    const view = host.render(instance(1));
    expect(view.ok && view.value).toBe('light');
  });

  it('does nothing for a widget with no surface', () => {
    const { host, journal } = scenario();
    host.create(instance(1));

    host.applyTheme(fallbackSnapshot('light'));

    expect(host.contextOf(instance(1))).toBeUndefined();
    expect(journal.events).toEqual([]);
  });

  it('ignores a re-application of the same theme', () => {
    const { host, journal } = scenario();
    attachRunning(host, 1);

    host.applyTheme(fallbackSnapshot('dark'));
    expect(journal.events).toEqual([]);
  });

  it('recognises an equal snapshot resolved separately', () => {
    // Compared by content hash, so a re-resolve on an unrelated change does not
    // tell every widget the theme moved when it did not.
    const { host, journal } = scenario();
    attachRunning(host, 1);

    const equal = fallbackSnapshot('dark');
    const alsoEqual = fallbackSnapshot('dark');
    expect(equal.hash).toBe(alsoEqual.hash);

    host.applyTheme(alsoEqual);
    expect(journal.events).toEqual([]);
  });

  it('builds later widgets from the theme in force', () => {
    const { host } = scenario();
    host.applyTheme(fallbackSnapshot('light'));
    attachRunning(host, 1);

    expect(host.contextOf(instance(1))?.theme.metadata.mode).toBe('light');
  });

  it('reports a widget whose handler throws, without stopping the sweep', () => {
    const registered = createWidgetRegistry().register(MANIFEST);
    if (!registered.ok) throw new Error('fixture');

    const host = new WidgetHost<number, string>(registered.value, fallbackSnapshot('dark'));
    const defined = host.define({
      id: id(CLOCK),
      cadence: NO_CADENCE,
      initialize(context) {
        context.events.subscribe(() => {
          throw new Error('bad handler');
        });
        return 0;
      },
      update: (state) => state,
      render: (_state, context) => context.theme.metadata.mode,
    });
    if (!defined.ok) throw new Error('fixture');

    for (const ordinal of [1, 2]) attachRunning(host, ordinal);
    const affected = host.applyTheme(fallbackSnapshot('light'));

    expect(affected).toHaveLength(2);
    // Both still got the new theme: the failure was in their listener, not in
    // the propagation.
    expect(host.contextOf(instance(1))?.theme.metadata.mode).toBe('light');
    expect(host.contextOf(instance(2))?.theme.metadata.mode).toBe('light');
  });
});

describe('moveToMonitor', () => {
  it('tells one widget its display changed', () => {
    const { host, journal } = scenario();
    attachRunning(host, 1);

    const moved = host.moveToMonitor(instance(1), monitor('unit:SN-EXTERNAL'));
    expect(moved.ok).toBe(true);
    expect(host.contextOf(instance(1))?.monitorId).toBe('unit:SN-EXTERNAL');
    expect(journal.events.some((event) => event.kind === 'monitor-changed')).toBe(true);
  });

  it('does not tell the widgets that did not move', () => {
    // A display leaving re-associates the surfaces that were on it and no
    // others. Telling the rest would have every widget re-render for a change
    // that did not touch it.
    const { host, journal } = scenario();
    attachRunning(host, 1);
    attachRunning(host, 2);
    journal.events.length = 0;

    host.moveToMonitor(instance(1), monitor('unit:SN-EXTERNAL'));

    expect(host.contextOf(instance(2))?.monitorId).toBe('unit:SN-LAPTOP');
    expect(journal.events).toHaveLength(1); // instance 1 only
  });

  it('can clear the display', () => {
    const { host } = scenario();
    attachRunning(host, 1);

    expect(host.moveToMonitor(instance(1), undefined).ok).toBe(true);
    expect(host.contextOf(instance(1))?.monitorId).toBeUndefined();
  });

  it('says nothing when the display did not actually change', () => {
    const { host, journal } = scenario();
    attachRunning(host, 1);
    journal.events.length = 0;

    host.moveToMonitor(instance(1), monitor('unit:SN-LAPTOP'));
    expect(journal.events).toEqual([]);
  });

  it('refuses a widget with no surface', () => {
    const { host } = scenario();
    host.create(instance(1));

    expect(host.moveToMonitor(instance(1), monitor('unit:SN-LAPTOP')).ok).toBe(false);
  });

  it('refuses an unknown instance', () => {
    const { host } = scenario();
    expect(host.moveToMonitor(instance(9), undefined).ok).toBe(false);
  });
});
