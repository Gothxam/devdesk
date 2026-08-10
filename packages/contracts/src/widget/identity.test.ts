import { describe, expect, it } from 'vitest';

import {
  ordinalOf,
  parseWidgetInstanceId,
  widgetId,
  widgetInstanceId,
  widgetOf,
} from './identity';

function id(value: string) {
  const parsed = widgetId(value);
  if (!parsed.ok) throw new Error(`fixture id must be valid: ${value}`);
  return parsed.value;
}

describe('widgetId', () => {
  it('accepts a qualified, lowercase, dotted name', () => {
    expect(widgetId('devdesk.clock').ok).toBe(true);
    expect(widgetId('acme-labs.system-monitor').ok).toBe(true);
    expect(widgetId('com.acme.weather').ok).toBe(true);
  });

  it('rejects an unqualified name', () => {
    // `clock` collides the moment a second author publishes one, and the
    // registry cannot tell which one a stored arrangement meant.
    const rejected = widgetId('clock');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.kind).toBe('malformed');
  });

  it('rejects what cannot be a path segment or a log field', () => {
    for (const bad of ['DevDesk.Clock', 'devdesk clock', 'devdesk/clock', 'devdesk..clock', '.clock', 'devdesk.']) {
      expect(widgetId(bad).ok, bad).toBe(false);
    }
  });

  it('rejects empty and whitespace', () => {
    expect(widgetId('').ok).toBe(false);
    expect(widgetId('   ').ok).toBe(false);
  });

  it('rejects an id too long for a window label or a path segment', () => {
    const long = `devdesk.${'a'.repeat(200)}`;
    const rejected = widgetId(long);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.kind).toBe('too-long');
  });

  it('trims before validating', () => {
    const parsed = widgetId('  devdesk.clock  ');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe('devdesk.clock');
  });
});

describe('widgetInstanceId', () => {
  it('composes a readable identity from a widget and an ordinal', () => {
    const instance = widgetInstanceId(id('devdesk.clock'), 2);
    expect(instance.ok).toBe(true);
    if (instance.ok) expect(instance.value).toBe('devdesk.clock#2');
  });

  it('refuses an ordinal that is not a counting number', () => {
    // The ordinal is what a user means by "my second clock". Zero, negatives,
    // and fractions are not placements.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(widgetInstanceId(id('devdesk.clock'), bad).ok, String(bad)).toBe(false);
    }
  });

  it('survives a round trip through storage', () => {
    // The invariant: an instance identity outlives the process. If this did not
    // hold, a restored arrangement would attach to the wrong instance or none.
    const original = widgetInstanceId(id('devdesk.clock'), 3);
    if (!original.ok) throw new Error('fixture');

    const stored = JSON.stringify({ instance: original.value });
    const recovered = parseWidgetInstanceId(
      (JSON.parse(stored) as { instance: string }).instance,
    );

    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.value).toBe(original.value);
  });

  it('decomposes back into its widget and its ordinal', () => {
    const instance = widgetInstanceId(id('com.acme.weather'), 7);
    if (!instance.ok) throw new Error('fixture');

    expect(widgetOf(instance.value)).toBe('com.acme.weather');
    expect(ordinalOf(instance.value)).toBe(7);
  });

  it('distinguishes two placements of one widget', () => {
    const first = widgetInstanceId(id('devdesk.clock'), 1);
    const second = widgetInstanceId(id('devdesk.clock'), 2);
    if (!first.ok || !second.ok) throw new Error('fixture');

    expect(first.value).not.toBe(second.value);
    expect(widgetOf(first.value)).toBe(widgetOf(second.value));
  });
});

describe('parseWidgetInstanceId', () => {
  it('rejects text that is not an instance identity', () => {
    // A stored identity that no longer parses is a corrupt configuration.
    // Reading it loosely would place a widget under an identity nothing else
    // refers to.
    for (const bad of ['devdesk.clock', '#1', 'devdesk.clock#', 'devdesk.clock#0', 'clock#1', '']) {
      expect(parseWidgetInstanceId(bad).ok, bad).toBe(false);
    }
  });

  it('accepts an id containing dots before the ordinal', () => {
    const parsed = parseWidgetInstanceId('com.acme.weather#12');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(ordinalOf(parsed.value)).toBe(12);
  });
});
