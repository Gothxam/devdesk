import { widgetId } from '@devdesk/contracts';
import { describe, expect, it } from 'vitest';

import {
  createWidgetRegistry,
  describeRegistrationError,
  registerAll,
  validateManifest,
} from './registry';

function id(value: string) {
  const parsed = widgetId(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'devdesk.clock',
    name: 'Clock',
    version: '1.0.0',
    description: 'The time, on your desktop.',
    capabilities: [],
    preferredSize: { width: 240, height: 120 },
    ...overrides,
  };
}

describe('WidgetRegistry', () => {
  it('starts empty', () => {
    const registry = createWidgetRegistry();
    expect(registry.size).toBe(0);
    expect(registry.enumerate()).toEqual([]);
  });

  it('registers a valid manifest and finds it again', () => {
    const result = createWidgetRegistry().register(manifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.size).toBe(1);
    expect(result.value.has(id('devdesk.clock'))).toBe(true);
    expect(result.value.lookup(id('devdesk.clock'))?.name).toBe('Clock');
  });

  it('refuses an invalid manifest with every problem', () => {
    const result = createWidgetRegistry().register({ id: 'Clock' });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe('invalid-manifest');
    if (result.error.kind === 'invalid-manifest') {
      expect(result.error.problems.length).toBeGreaterThan(1);
    }
  });

  it('refuses a duplicate id rather than replacing', () => {
    // A silent replacement means two authors shipped the same id and the winner
    // is whoever loaded last — which changes between launches, taking every
    // placed instance with it.
    const first = createWidgetRegistry().register(manifest());
    if (!first.ok) throw new Error('fixture');

    const second = first.value.register(manifest({ name: 'Impostor' }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe('already-registered');

    expect(first.value.lookup(id('devdesk.clock'))?.name).toBe('Clock');
  });

  it('does not mutate the registry it was called on', () => {
    // A caller holding a registry can iterate it across arbitrary work and know
    // the set did not change underneath.
    const empty = createWidgetRegistry();
    const result = empty.register(manifest());

    expect(empty.size).toBe(0);
    expect(result.ok && result.value.size).toBe(1);
  });

  it('unregisters, leaving the previous registry intact', () => {
    const registered = createWidgetRegistry().register(manifest());
    if (!registered.ok) throw new Error('fixture');

    const removed = registered.value.unregister(id('devdesk.clock'));
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.size).toBe(0);
    expect(registered.value.size).toBe(1);
  });

  it('refuses to unregister something that was never registered', () => {
    const result = createWidgetRegistry().unregister(id('devdesk.nothing'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-registered');
  });

  it('enumerates by identity, not by registration order', () => {
    // Registration order is an accident of startup timing. A picker listing by
    // it would reorder itself between launches for no visible reason.
    const { registry } = registerAll(createWidgetRegistry(), [
      manifest({ id: 'zulu.widget' }),
      manifest({ id: 'alpha.widget' }),
      manifest({ id: 'mike.widget' }),
    ]);

    expect(registry.enumerate().map((entry) => entry.id)).toEqual([
      'alpha.widget',
      'mike.widget',
      'zulu.widget',
    ]);
  });

  it('freezes what it enumerates', () => {
    const registered = createWidgetRegistry().register(manifest());
    if (!registered.ok) throw new Error('fixture');
    expect(Object.isFrozen(registered.value.enumerate())).toBe(true);
  });

  it('re-registering after unregistering is allowed', () => {
    const registered = createWidgetRegistry().register(manifest());
    if (!registered.ok) throw new Error('fixture');
    const removed = registered.value.unregister(id('devdesk.clock'));
    if (!removed.ok) throw new Error('fixture');

    expect(removed.value.register(manifest()).ok).toBe(true);
  });
});

describe('registerAll', () => {
  it('keeps the good and reports the bad', () => {
    // AC-ERR-2.2: one malformed third-party widget must not take the desktop
    // down with it.
    const { registry, rejected } = registerAll(createWidgetRegistry(), [
      manifest({ id: 'devdesk.clock' }),
      { id: 'broken' },
      manifest({ id: 'devdesk.monitor' }),
      manifest({ id: 'devdesk.clock' }),
    ]);

    expect(registry.size).toBe(2);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((entry) => entry.error.kind)).toEqual([
      'invalid-manifest',
      'already-registered',
    ]);
  });

  it('describes every rejection in terms an author can act on', () => {
    const { rejected } = registerAll(createWidgetRegistry(), [{ id: 'broken' }]);
    for (const entry of rejected) {
      const described = describeRegistrationError(entry.error);
      expect(described.length).toBeGreaterThan(0);
      expect(described).not.toContain('undefined');
    }
  });
});

describe('validateManifest', () => {
  it('answers without registering anything', () => {
    expect(validateManifest(manifest()).ok).toBe(true);
    expect(validateManifest({}).ok).toBe(false);
  });
});
