import { useEffect, useRef } from 'react';

import { NO_ACCESSIBILITY_PREFERENCES } from '@devdesk/theme-engine';

import { createThemeController } from './theme/controller';
import { BUNDLED_THEME_DATA, DEFAULT_THEME_ID, buildRegistry } from './theme/registry';

/**
 * The DevDesk shell — Trust Zone 1 (SYSTEM_ARCHITECTURE.md §18.2).
 *
 * Holds a projection of core state and never an authority over it (ST-1).
 * Surface composition and settings land in later Sprint 1 commits; today it
 * exists to prove the theme pipeline runs end to end against a real document.
 */
export function Shell(): React.JSX.Element {
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;

    const registry = buildRegistry(BUNDLED_THEME_DATA);
    for (const rejection of registry.rejected) {
      // P-9: a theme that failed to load says so. Silence would leave the user
      // wondering why their selection did nothing.
      console.error(`Theme rejected (${rejection.source}): ${rejection.reason}`);
    }

    const controller = createThemeController(registry, document.documentElement);
    const outcome = controller.apply({
      themeId: DEFAULT_THEME_ID,
      mode: window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
      accessibility: {
        ...NO_ACCESSIBILITY_PREFERENCES,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        reducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
      },
    });

    if (!outcome.ok) console.error(`Theme could not be applied: ${outcome.reason}`);
  }, []);

  return <div data-devdesk-shell="root" />;
}
