import { describe, expect, it } from 'vitest';

import { describeThemeParseError, parseThemeSource } from './parse';

describe('parseThemeSource', () => {
  it('accepts a minimal well-formed theme', () => {
    const parsed = parseThemeSource({
      id: 'x', name: 'X',
      modes: {
        light: { base: { 'color.a': { kind: 'color', value: '#fff' } } },
        dark: {
          base: { 'color.a': { kind: 'color', value: '#000' } },
          semantic: { 'surface.bg': { kind: 'color', value: { ref: 'color.a' } } },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.modes.dark.semantic['surface.bg']?.value.form).toBe('reference');
  });

  it('defaults an omitted layer to empty rather than failing', () => {
    const parsed = parseThemeSource({
      id: 'x', name: 'X',
      modes: { light: {}, dark: { base: { 'color.a': { kind: 'color', value: '#000' } } } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.modes.dark.component).toEqual({});
  });

  it('rejects an unknown kind and names the path', () => {
    const parsed = parseThemeSource({
      id: 't', name: 'T',
      modes: { light: {}, dark: { base: { 'a.b': { kind: 'colr', value: '#fff' } } } },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.path).toBe('modes.dark.base.a.b.kind');
    expect(describeThemeParseError(parsed.error)).toContain('not a known token kind');
  });

  it('rejects a theme missing a mode', () => {
    const parsed = parseThemeSource({ id: 't', name: 'T', modes: { dark: {} } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.path).toBe('modes.light');
  });

  it('cannot express executable content: a function-valued token is rejected', () => {
    const parsed = parseThemeSource({
      id: 't', name: 'T',
      modes: { light: {}, dark: { base: { 'a.b': { kind: 'color', value: { call: 'eval' } } } } },
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a non-string literal rather than coercing it', () => {
    const parsed = parseThemeSource({
      id: 't', name: 'T',
      modes: { light: {}, dark: { base: { 'a.b': { kind: 'opacity', value: 0.5 } } } },
    });
    expect(parsed.ok).toBe(false);
  });
});
