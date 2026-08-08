import { describe, expect, it } from 'vitest';

import { NO_ACCESSIBILITY_PREFERENCES, resolveTheme } from './resolve';
import type { ResolutionContext } from './resolve';
import { type ThemeSource, type TokenSet, literal, reference, tokenId } from './token';

const CONTEXT: ResolutionContext = {
  mode: 'dark',
  accessibility: NO_ACCESSIBILITY_PREFERENCES,
};

function theme(dark: TokenSet): ThemeSource {
  const empty: TokenSet = { base: {}, semantic: {}, component: {} };
  return { id: 'test', name: 'Test', modes: { dark, light: empty } };
}

describe('resolveTheme', () => {
  it('resolves a literal base token', () => {
    const result = resolveTheme(
      theme({ base: { 'color.slate.900': literal('color', '#0f1115') }, semantic: {}, component: {} }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokens.get(tokenId('color.slate.900'))).toBe('#0f1115');
  });

  it('resolves a reference chain component -> semantic -> base', () => {
    const result = resolveTheme(
      theme({
        base: { 'color.slate.900': literal('color', '#0f1115') },
        semantic: { 'surface.background': reference('color', 'color.slate.900') },
        component: { 'panel.background': reference('color', 'surface.background') },
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokens.get(tokenId('panel.background'))).toBe('#0f1115');
    expect(result.value.tokens.get(tokenId('surface.background'))).toBe('#0f1115');
  });

  it('is total: an unresolvable reference with a fallback resolves to the fallback', () => {
    const result = resolveTheme(
      theme({
        base: {},
        semantic: { 'surface.background': reference('color', 'color.missing', '#000000') },
        component: {},
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokens.get(tokenId('surface.background'))).toBe('#000000');
    expect(result.value.origins.get(tokenId('surface.background'))).toBe('fallback');
  });

  it('fails at load, not at paint, when a reference has no target and no fallback', () => {
    const result = resolveTheme(
      theme({ base: {}, semantic: { 'surface.background': reference('color', 'color.missing') }, component: {} }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unknown-reference');
  });

  // TH-3 requires resolution to be total AND cycle-detecting, and §26.5 keeps
  // cycle-detection a standing constraint so a future expression evaluator can be
  // inserted between resolution phases without restructuring the cascade.
  //
  // Today the layer rule delivers something stronger: because a reference must
  // strictly DECREASE in layer rank, a cycle cannot form at all. The three tests
  // below pin that down, so if the layer rule is ever relaxed, the cycle branch
  // in resolve.ts becomes reachable rather than quietly wrong.
  it('makes cycles structurally unreachable: a same-layer loop is rejected as inversion', () => {
    const result = resolveTheme(
      theme({
        base: {},
        semantic: {},
        component: {
          'a.value': reference('color', 'b.value'),
          'b.value': reference('color', 'c.value'),
          'c.value': reference('color', 'a.value'),
        },
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Not 'cycle': the loop is refused one edge earlier, at the first same-layer hop.
    expect(result.error.kind).toBe('layer-inversion');
  });

  it('rejects a self-reference before it can loop', () => {
    const result = resolveTheme(
      theme({ base: {}, semantic: { 'x.self': reference('color', 'x.self') }, component: {} }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('layer-inversion');
  });

  it('rejects an upward reference from semantic to component', () => {
    const result = resolveTheme(
      theme({
        base: { 'color.a': literal('color', '#fff') },
        semantic: { 'surface.bg': reference('color', 'panel.bg') },
        component: { 'panel.bg': reference('color', 'color.a') },
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('layer-inversion');
  });

  it('rejects layer inversion: a base token may not reference upward', () => {
    const result = resolveTheme(
      theme({
        base: { 'color.primary': reference('color', 'surface.background') },
        semantic: { 'surface.background': literal('color', '#0f1115') },
        component: {},
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('base-token-is-reference');
  });

  it('rejects a sideways reference within the same layer', () => {
    const result = resolveTheme(
      theme({
        base: { 'color.a': literal('color', '#fff') },
        semantic: { 'x.one': reference('color', 'x.two'), 'x.two': reference('color', 'color.a') },
        component: {},
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('layer-inversion');
  });

  it('applies accessibility overrides last, so no theme can shadow them', () => {
    const result = resolveTheme(
      theme({
        base: { 'motion.fast': literal('motion-duration', '160ms') },
        semantic: { 'motion.panel': reference('motion-duration', 'motion.fast') },
        component: {},
      }),
      CONTEXT,
      new Map([[tokenId('motion.panel'), '0ms']]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokens.get(tokenId('motion.panel'))).toBe('0ms');
    expect(result.value.origins.get(tokenId('motion.panel'))).toBe('accessibility-override');
    expect(result.value.accessibilityOverrides.has(tokenId('motion.panel'))).toBe(true);
  });

  it('produces a frozen snapshot so consumers cannot mutate shared theme state', () => {
    const result = resolveTheme(
      theme({ base: { 'color.a': literal('color', '#fff') }, semantic: {}, component: {} }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('produces distinct snapshots, so an earlier holder is unaffected by a later resolution', () => {
    const source = theme({ base: { 'color.a': literal('color', '#fff') }, semantic: {}, component: {} });
    const first = resolveTheme(source, CONTEXT);
    const second = resolveTheme(source, CONTEXT);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).not.toBe(second.value);
    expect(first.value.tokens.get(tokenId('color.a'))).toBe('#fff');
  });

  it('reports an undefined mode rather than resolving an empty theme', () => {
    const source = { id: 't', name: 'T', modes: {} } as unknown as ThemeSource;
    const result = resolveTheme(source, CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unknown-mode');
  });
});
