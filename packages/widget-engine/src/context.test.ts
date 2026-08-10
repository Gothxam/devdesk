import { monitorId, surfaceId, widgetId, widgetInstanceId } from '@devdesk/contracts';
import { fallbackSnapshot } from '@devdesk/theme-engine';
import { describe, expect, it } from 'vitest';

import { createWidgetContext, withUpdates } from './context';
import { createEventChannel } from './events';

function context() {
  const widget = widgetId('devdesk.clock');
  if (!widget.ok) throw new Error('fixture');
  const instance = widgetInstanceId(widget.value, 1);
  const surface = surfaceId('surface-1');
  const monitor = monitorId('unit:SN-LAPTOP');
  if (!instance.ok || !surface.ok || !monitor.ok) throw new Error('fixture');

  return createWidgetContext({
    widgetId: widget.value,
    instanceId: instance.value,
    surfaceId: surface.value,
    monitorId: monitor.value,
    theme: fallbackSnapshot('dark'),
    events: createEventChannel(),
  });
}

describe('createWidgetContext', () => {
  it('freezes what it builds', () => {
    // A widget can hold a context across arbitrary work and know every field it
    // reads describes one consistent moment — the guarantee DisplayGraph gives
    // the layout path.
    expect(Object.isFrozen(context())).toBe(true);
  });

  it('carries a resolved theme, not a source', () => {
    // Handing widgets a source would mean N implementations of the cascade, N
    // chances to disagree, and N places to fix a bug in it.
    const built = context();
    expect(built.theme.tokens).toBeDefined();
    expect(built.theme.metadata.themeId).toBeDefined();
  });
});

describe('withUpdates', () => {
  it('returns a new context and leaves the old one alone', () => {
    const before = context();
    const after = withUpdates(before, { theme: fallbackSnapshot('light') });

    expect(after).not.toBe(before);
    expect(before.theme.metadata.mode).toBe('dark');
    expect(after.theme.metadata.mode).toBe('light');
  });

  it('changes only what it is given', () => {
    const before = context();
    const after = withUpdates(before, { theme: fallbackSnapshot('light') });

    expect(after.widgetId).toBe(before.widgetId);
    expect(after.instanceId).toBe(before.instanceId);
    expect(after.surfaceId).toBe(before.surfaceId);
    expect(after.monitorId).toBe(before.monitorId);
    expect(after.events).toBe(before.events);
  });

  it('can clear the display, which is a real state', () => {
    const before = context();
    const after = withUpdates(before, { monitorId: undefined });

    expect(after.monitorId).toBeUndefined();
    expect(after.theme).toBe(before.theme);
  });

  it('leaves the display alone when it is not mentioned', () => {
    // `{ monitorId: undefined }` and `{}` mean different things, and confusing
    // them would silently detach a widget from its display on a theme change.
    const before = context();
    const after = withUpdates(before, { theme: fallbackSnapshot('light') });

    expect(after.monitorId).toBe(before.monitorId);
  });

  it('freezes the result', () => {
    expect(Object.isFrozen(withUpdates(context(), {}))).toBe(true);
  });

  it('offers no way to change identity or surface', () => {
    // A widget that moved surface has detached and re-attached, which builds a
    // context from scratch. Editing one in place would let a context disagree
    // with its lifecycle phase.
    const after = withUpdates(context(), {});
    expect(Object.keys(after).sort()).toEqual([
      'events',
      'instanceId',
      'monitorId',
      'surfaceId',
      'theme',
      'widgetId',
    ]);
  });
});
