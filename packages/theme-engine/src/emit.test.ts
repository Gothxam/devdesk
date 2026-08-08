import { describe, expect, it } from 'vitest';

import { accessibilityOverrides, declaredTokenIds, describeActiveOverrides } from './accessibility';
import { customPropertyName, diffCustomProperties, findUnemittableTokens, toCustomProperties } from './emit';
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
    'color.slate.900': literal('#0f1115'),
    'motion.duration.fast': literal('160ms'),
    'effect.blur.panel': literal('24px'),
    'effect.opacity.glass': literal('0.72'),
  },
  semantic: { 'surface.background': reference('color.slate.900') },
  component: { 'panel.background': reference('surface.background') },
};

describe('customPropertyName', () => {
  it('maps dotted token ids to dashed custom properties', () => {
    expect(customPropertyName(tokenId('surface.glass.tint'))).toBe('--surface-glass-tint');
  });
});

describe('toCustomProperties', () => {
  it('emits every resolved token', () => {
    const result = resolveTheme(theme(SAMPLE), CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const props = toCustomProperties(result.value);
    expect(props['--panel-background']).toBe('#0f1115');
    expect(props['--surface-background']).toBe('#0f1115');
    expect(props['--color-slate-900']).toBe('#0f1115');
  });

  it('returns a frozen object so emission output cannot be mutated in place', () => {
    const result = resolveTheme(theme(SAMPLE), CONTEXT);
    if (!result.ok) return;
    expect(Object.isFrozen(toCustomProperties(result.value))).toBe(true);
  });

  it('omits unemittable ids rather than emitting a malformed property', () => {
    const result = resolveTheme(
      theme({ base: { 'Bad Token!': literal('#fff'), 'color.a': literal('#000') }, semantic: {}, component: {} }),
      CONTEXT,
    );
    if (!result.ok) return;

    const props = toCustomProperties(result.value);
    expect(Object.keys(props)).toEqual(['--color-a']);
    expect(findUnemittableTokens(result.value)).toEqual([tokenId('Bad Token!')]);
  });
});

describe('diffCustomProperties', () => {
  it('returns everything when there is no previous snapshot', () => {
    const next = resolveTheme(theme(SAMPLE), CONTEXT);
    if (!next.ok) return;
    expect(Object.keys(diffCustomProperties(undefined, next.value)).length).toBeGreaterThan(0);
  });

  it('returns only what changed between two snapshots', () => {
    const before = resolveTheme(theme(SAMPLE), CONTEXT);
    const after = resolveTheme(
      theme({ ...SAMPLE, base: { ...SAMPLE.base, 'color.slate.900': literal('#ffffff') } }),
      CONTEXT,
    );
    if (!before.ok || !after.ok) return;

    const changes = diffCustomProperties(before.value, after.value);
    expect(changes['--color-slate-900']).toBe('#ffffff');
    // Untouched tokens are absent, not re-emitted with the same value.
    expect('--effect-blur-panel' in changes).toBe(false);
  });

  it('marks a removed property as null so a stale value is not left behind', () => {
    const before = resolveTheme(theme(SAMPLE), CONTEXT);
    const after = resolveTheme(
      theme({ base: { 'color.slate.900': literal('#0f1115') }, semantic: {}, component: {} }),
      CONTEXT,
    );
    if (!before.ok || !after.ok) return;

    expect(diffCustomProperties(before.value, after.value)['--effect-blur-panel']).toBeNull();
  });

  it('produces no changes between two resolutions of the same source', () => {
    const a = resolveTheme(theme(SAMPLE), CONTEXT);
    const b = resolveTheme(theme(SAMPLE), CONTEXT);
    if (!a.ok || !b.ok) return;
    expect(Object.keys(diffCustomProperties(a.value, b.value))).toEqual([]);
  });
});

describe('accessibility overrides', () => {
  it('neutralises motion when reduced motion is set', () => {
    const overrides = accessibilityOverrides(declaredTokenIds(SAMPLE), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedMotion: true,
    });
    expect(overrides.get(tokenId('motion.duration.fast'))).toBe('0ms');
    expect(overrides.has(tokenId('effect.blur.panel'))).toBe(false);
  });

  it('neutralises blur and opacity when reduced transparency is set', () => {
    const overrides = accessibilityOverrides(declaredTokenIds(SAMPLE), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedTransparency: true,
    });
    expect(overrides.get(tokenId('effect.blur.panel'))).toBe('0px');
    expect(overrides.get(tokenId('effect.opacity.glass'))).toBe('1');
  });

  it('cannot be shadowed by a theme that declares the same token', () => {
    const overrides = accessibilityOverrides(declaredTokenIds(SAMPLE), {
      ...NO_ACCESSIBILITY_PREFERENCES,
      reducedMotion: true,
    });
    const result = resolveTheme(theme(SAMPLE), CONTEXT, overrides);
    if (!result.ok) return;

    // The theme says 160ms. The operating system wins, unconditionally (D-5).
    expect(result.value.tokens.get(tokenId('motion.duration.fast'))).toBe('0ms');
    expect(toCustomProperties(result.value)['--motion-duration-fast']).toBe('0ms');
  });

  it('reports which preferences are controlling values, for the user', () => {
    const overrides = accessibilityOverrides(declaredTokenIds(SAMPLE), {
      reducedMotion: true,
      reducedTransparency: true,
      highContrast: false,
    });
    const result = resolveTheme(theme(SAMPLE), CONTEXT, overrides);
    if (!result.ok) return;

    expect([...describeActiveOverrides(result.value)].sort()).toEqual([
      'Reduced motion',
      'Reduced transparency',
    ]);
  });

  it('reports nothing when no preference is active', () => {
    const result = resolveTheme(theme(SAMPLE), CONTEXT);
    if (!result.ok) return;
    expect(describeActiveOverrides(result.value)).toEqual([]);
  });
});
