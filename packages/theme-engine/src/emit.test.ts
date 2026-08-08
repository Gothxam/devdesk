import { describe, expect, it } from 'vitest';

import { accessibilityOverrides, declaredTokens, describeActiveOverrides } from './accessibility';
import { customPropertyName, emitDiff } from './emit';
import { diffSnapshots } from './diff';
import { NO_ACCESSIBILITY_PREFERENCES, resolveTheme } from './resolve';
import type { ResolutionContext } from './resolve';
import { type ThemeSource, type TokenSet, literal, reference, tokenId } from './token';

const CONTEXT: ResolutionContext = { mode: 'dark', accessibility: NO_ACCESSIBILITY_PREFERENCES };

function theme(dark: TokenSet): ThemeSource {
  const empty: TokenSet = { base: {}, semantic: {}, component: {} };
  return { id: 'test', name: 'Test', modes: { dark, light: empty } };
}

const SAMPLE: TokenSet = {
  base: {
    'color.slate.900': literal('color', '#0f1115'),
    'motion.duration.fast': literal('motion-duration', '160ms'),
    'effect.blur.panel': literal('blur-radius', '24px'),
    'effect.opacity.glass': literal('opacity', '0.72'),
  },
  semantic: { 'surface.background': reference('color', 'color.slate.900') },
  component: { 'panel.background': reference('color', 'surface.background') },
};

describe('customPropertyName', () => {
  it('maps dotted token ids to dashed custom properties', () => {
    expect(customPropertyName(tokenId('surface.glass.tint'))).toBe('--surface-glass-tint');
  });
});

describe('accessibility overrides', () => {
  it('neutralises motion when reduced motion is set', () => {
    const overrides = accessibilityOverrides(declaredTokens(SAMPLE), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedMotion: true,
    });
    expect(overrides.get(tokenId('motion.duration.fast'))).toBe('0ms');
    expect(overrides.has(tokenId('effect.blur.panel'))).toBe(false);
  });

  it('neutralises blur and opacity when reduced transparency is set', () => {
    const overrides = accessibilityOverrides(declaredTokens(SAMPLE), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedTransparency: true,
    });
    expect(overrides.get(tokenId('effect.blur.panel'))).toBe('0px');
    expect(overrides.get(tokenId('effect.opacity.glass'))).toBe('1');
  });

  it('cannot be shadowed by a theme that declares the same token', () => {
    const overrides = accessibilityOverrides(declaredTokens(SAMPLE), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedMotion: true,
    });
    const result = resolveTheme(theme(SAMPLE), CONTEXT, overrides);
    if (!result.ok) return;

    // The theme says 160ms. The operating system wins, unconditionally (D-5).
    expect(result.value.tokens.get(tokenId('motion.duration.fast'))).toBe('0ms');
    expect(emitDiff(diffSnapshots(undefined, result.value)).set['--motion-duration-fast']).toBe('0ms');
  });

  it('reports which preferences are controlling values, for the user', () => {
    const overrides = accessibilityOverrides(declaredTokens(SAMPLE), {
      reducedMotion: true,
      reducedTransparency: true,
      highContrast: false,
    });
    const result = resolveTheme(theme(SAMPLE), CONTEXT, overrides);
    if (!result.ok) return;

    expect([...describeActiveOverrides(result.value, declaredTokens(SAMPLE))].sort()).toEqual([
      'Reduced motion',
      'Reduced transparency',
    ]);
  });

  it('reports nothing when no preference is active', () => {
    const result = resolveTheme(theme(SAMPLE), CONTEXT);
    if (!result.ok) return;
    expect(describeActiveOverrides(result.value, declaredTokens(SAMPLE))).toEqual([]);
  });
});

describe('declared kinds', () => {
  it('rejects a misdeclared kind instead of silently skipping the override', () => {
    const result = resolveTheme(
      theme({
        base: { 'motion.duration.fast': { kind: 'moiton-duration', value: { form: 'literal', value: '160ms' } } },
        semantic: {},
        component: {},
      } as unknown as TokenSet),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unknown-token-kind');
  });

  it('rejects a reference that changes kind', () => {
    const result = resolveTheme(
      theme({
        base: { 'motion.fast': literal('motion-duration', '160ms') },
        semantic: { 'surface.tint': reference('color', 'motion.fast') },
        component: {},
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('kind-mismatch');
  });

  it('overrides by kind, not by name: an oddly-named duration is still neutralised', () => {
    const odd: TokenSet = {
      base: { 'ui.speed.snappy': literal('motion-duration', '160ms') },
      semantic: {},
      component: {},
    };
    const overrides = accessibilityOverrides(declaredTokens(odd), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedMotion: true,
    });
    const result = resolveTheme(theme(odd), CONTEXT, overrides);
    if (!result.ok) return;

    expect(result.value.tokens.get(tokenId('ui.speed.snappy'))).toBe('0ms');
  });
});
