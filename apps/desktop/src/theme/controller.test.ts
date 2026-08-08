import { describe, expect, it } from 'vitest';

import { NO_ACCESSIBILITY_PREFERENCES } from '@devdesk/theme-engine';

import { createThemeController } from './controller';
import { BUNDLED_THEME_DATA, DEFAULT_THEME_ID, buildRegistry } from './registry';

/** A minimal stand-in for a document root; only style is exercised. */
function fakeRoot(): HTMLElement & { readonly props: Map<string, string> } {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => void props.delete(name),
    },
  } as unknown as HTMLElement & { readonly props: Map<string, string> };
}

const PREFS = NO_ACCESSIBILITY_PREFERENCES;

describe('bundled theme registry', () => {
  it('validates every bundled theme', () => {
    const registry = buildRegistry(BUNDLED_THEME_DATA);
    expect(registry.rejected).toEqual([]);
    expect(registry.themes.map((t) => t.id).sort()).toEqual(['devdesk.default', 'devdesk.slate']);
  });

  it('excludes an invalid theme with a reason rather than failing the whole registry', () => {
    const registry = buildRegistry([
      ...BUNDLED_THEME_DATA,
      { source: 'themes/broken', data: { id: 'b', name: 'B', modes: { dark: {} } } },
    ]);
    expect(registry.themes).toHaveLength(2);
    expect(registry.rejected).toHaveLength(1);
    expect(registry.rejected[0]?.reason).toContain('modes.light');
  });
});

describe('runtime theme switching', () => {
  it('applies a theme by writing custom properties to the root', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);

    expect(controller.apply({ themeId: DEFAULT_THEME_ID, mode: 'dark', accessibility: PREFS }).ok).toBe(true);
    expect(root.props.get('--surface-background')).toBe('#0f1115');
  });

  it('switching mode rewrites only what moved', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);
    controller.apply({ themeId: DEFAULT_THEME_ID, mode: 'dark', accessibility: PREFS });

    root.props.clear(); // observe only the second application
    controller.apply({ themeId: DEFAULT_THEME_ID, mode: 'light', accessibility: PREFS });

    expect(root.props.get('--surface-background')).toBe('#f7f8fa');
    // Shared across modes; not rewritten.
    expect(root.props.has('--motion-base')).toBe(false);
  });

  it('re-applying the current selection touches nothing', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);
    const selection = { themeId: DEFAULT_THEME_ID, mode: 'dark' as const, accessibility: PREFS };
    controller.apply(selection);

    root.props.clear();
    controller.apply(selection);
    expect(root.props.size).toBe(0);
  });

  it('switching theme rewrites only the differing tokens', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);
    controller.apply({ themeId: DEFAULT_THEME_ID, mode: 'dark', accessibility: PREFS });

    root.props.clear();
    controller.apply({ themeId: 'devdesk.slate', mode: 'dark', accessibility: PREFS });

    expect(root.props.get('--color-canvas')).toBe('#151a21');
    expect(root.props.has('--motion-base')).toBe(false);
  });

  it('reports an unknown theme instead of leaving the desktop half-themed', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);
    const outcome = controller.apply({ themeId: 'nope', mode: 'dark', accessibility: PREFS });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('nope');
    expect(root.props.size).toBe(0);
  });

  it('restores the default theme in one action from any state', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);
    controller.apply({ themeId: 'devdesk.slate', mode: 'light', accessibility: PREFS });

    controller.restoreDefault('dark', PREFS);

    expect(controller.applied?.themeId).toBe(DEFAULT_THEME_ID);
    expect(root.props.get('--surface-background')).toBe('#0f1115');
  });

  it('honours reduced motion through the applied patch', () => {
    const root = fakeRoot();
    const controller = createThemeController(buildRegistry(BUNDLED_THEME_DATA), root);
    controller.apply({
      themeId: DEFAULT_THEME_ID,
      mode: 'dark',
      accessibility: { ...PREFS, reducedMotion: true },
    });

    expect(root.props.get('--motion-base')).toBe('0ms');
    expect(root.props.get('--motion-transition')).toBe('0ms');
  });
});
