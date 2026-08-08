import { describe, expect, it } from 'vitest';

import { diffSnapshots, isEmptyDiff } from './diff';
import { emitDiff, isEmptyPatch } from './emit';
import { createSnapshotPool } from './intern';
import { NO_ACCESSIBILITY_PREFERENCES } from './preferences';
import type { ResolutionContext } from './resolve';
import { type ThemeSource, type TokenSet, literal, reference, tokenId } from './token';

const DARK: TokenSet = {
  base: { 'color.bg': literal('color', '#0f1115'), 'motion.fast': literal('motion-duration', '160ms') },
  semantic: { 'surface.background': reference('color', 'color.bg') },
  component: {},
};
const LIGHT: TokenSet = {
  base: { 'color.bg': literal('color', '#ffffff'), 'motion.fast': literal('motion-duration', '160ms') },
  semantic: { 'surface.background': reference('color', 'color.bg') },
  component: {},
};
const SOURCE: ThemeSource = { id: 'probe', name: 'Probe', modes: { dark: DARK, light: LIGHT } };
const DARK_CTX: ResolutionContext = { mode: 'dark', accessibility: NO_ACCESSIBILITY_PREFERENCES };
const LIGHT_CTX: ResolutionContext = { mode: 'light', accessibility: NO_ACCESSIBILITY_PREFERENCES };

describe('snapshot interning', () => {
  it('returns the same object for the same inputs', () => {
    const pool = createSnapshotPool();
    const a = pool.resolve(SOURCE, DARK_CTX);
    const b = pool.resolve(SOURCE, DARK_CTX);
    if (!a.ok || !b.ok) throw new Error('expected resolution to succeed');
    expect(a.value).toBe(b.value);
    expect(pool.size).toBe(1);
  });

  it('interns structurally identical sources to one snapshot', () => {
    const pool = createSnapshotPool();
    const copy: ThemeSource = { id: 'probe', name: 'Probe', modes: { dark: { ...DARK }, light: LIGHT } };
    const a = pool.resolve(SOURCE, DARK_CTX);
    const b = pool.resolve(copy, DARK_CTX);
    if (!a.ok || !b.ok) throw new Error('expected resolution to succeed');
    expect(a.value).toBe(b.value);
  });

  it('keeps modes and preference sets distinct', () => {
    const pool = createSnapshotPool();
    pool.resolve(SOURCE, DARK_CTX);
    pool.resolve(SOURCE, LIGHT_CTX);
    pool.resolve(SOURCE, { mode: 'dark', accessibility: { ...NO_ACCESSIBILITY_PREFERENCES, reducedMotion: true } });
    expect(pool.size).toBe(3);
  });

  it('is disposable: clearing changes nothing observable', () => {
    const pool = createSnapshotPool();
    const before = pool.resolve(SOURCE, DARK_CTX);
    pool.clear();
    const after = pool.resolve(SOURCE, DARK_CTX);
    if (!before.ok || !after.ok) throw new Error('expected resolution to succeed');
    expect(after.value).not.toBe(before.value);
    expect([...after.value.tokens]).toEqual([...before.value.tokens]);
  });

  it('applies accessibility overrides through the pool, so a cached snapshot cannot skip them', () => {
    const pool = createSnapshotPool();
    const result = pool.resolve(SOURCE, {
      mode: 'dark',
      accessibility: { ...NO_ACCESSIBILITY_PREFERENCES, reducedMotion: true },
    });
    if (!result.ok) throw new Error('expected resolution to succeed');
    expect(result.value.tokens.get(tokenId('motion.fast'))).toBe('0ms');
  });
});

describe('snapshot -> diff -> patch pipeline', () => {
  it('produces an empty diff for an interned re-resolution, without comparing tokens', () => {
    const pool = createSnapshotPool();
    const a = pool.resolve(SOURCE, DARK_CTX);
    const b = pool.resolve(SOURCE, DARK_CTX);
    if (!a.ok || !b.ok) throw new Error('expected resolution to succeed');

    const diff = diffSnapshots(a.value, b.value);
    expect(isEmptyDiff(diff)).toBe(true);
    expect(isEmptyPatch(emitDiff(diff))).toBe(true);
  });

  it('emits only the tokens that moved when switching mode', () => {
    const pool = createSnapshotPool();
    const dark = pool.resolve(SOURCE, DARK_CTX);
    const light = pool.resolve(SOURCE, LIGHT_CTX);
    if (!dark.ok || !light.ok) throw new Error('expected resolution to succeed');

    const patch = emitDiff(diffSnapshots(dark.value, light.value));
    expect(patch.set['--color-bg']).toBe('#ffffff');
    expect(patch.set['--surface-background']).toBe('#ffffff');
    // motion.fast is identical in both modes and is not re-emitted.
    expect('--motion-fast' in patch.set).toBe(false);
    expect(patch.remove).toEqual([]);
  });

  it('emits everything on first paint, through the same code path', () => {
    const pool = createSnapshotPool();
    const dark = pool.resolve(SOURCE, DARK_CTX);
    if (!dark.ok) throw new Error('expected resolution to succeed');

    const patch = emitDiff(diffSnapshots(undefined, dark.value));
    expect(Object.keys(patch.set).sort()).toEqual(['--color-bg', '--motion-fast', '--surface-background']);
  });

  it('removes a property rather than blanking it when a token disappears', () => {
    const pool = createSnapshotPool();
    const full = pool.resolve(SOURCE, DARK_CTX);
    const reduced = pool.resolve(
      { id: 'probe2', name: 'P2', modes: { dark: { base: { 'color.bg': literal('color', '#0f1115') }, semantic: {}, component: {} }, light: LIGHT } },
      DARK_CTX,
    );
    if (!full.ok || !reduced.ok) throw new Error('expected resolution to succeed');

    const patch = emitDiff(diffSnapshots(full.value, reduced.value));
    expect([...patch.remove].sort()).toEqual(['--motion-fast', '--surface-background']);
  });
});
