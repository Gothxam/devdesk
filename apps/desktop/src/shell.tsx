/**
 * Stage 5A — DevDesk Desktop Shell Component
 * Consumes real desktop controller metrics, ThemeSnapshot, and displays.
 */

import { useEffect, useRef, useState } from 'react';

import { commands, type WidgetInstanceId } from '@devdesk/contracts';
import {
  NO_ACCESSIBILITY_PREFERENCES,
  type AccessibilityPreferences,
  type ThemeMode,
} from '@devdesk/theme-engine';
import type { CompositionFrame } from '@devdesk/widget-engine';

import type { ClockView } from './widgets/clock/clock';
import { createSystemTimer } from './widgets/timer';
import { DesktopController } from './desktop/controller';
import { DesktopRoot, type HitReadout } from './desktop/desktop-root';
import { fetchPrimaryDisplay } from './desktop/displays';
import { createThemeController, type ThemeController } from './theme/controller';
import { BUNDLED_THEME_DATA, DEFAULT_THEME_ID, buildRegistry } from './theme/registry';

import { NavigationBar } from './desktop/components/navigation-bar';
import { StatusDock } from './desktop/components/status-dock';
import './shell.css';

interface DesktopState {
  readonly controller: DesktopController;
  readonly themes: ThemeController;
  readonly accessibility: AccessibilityPreferences;
}

function readAccessibility(): AccessibilityPreferences {
  return {
    ...NO_ACCESSIBILITY_PREFERENCES,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    reducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
  };
}

export function Shell(): React.JSX.Element {
  const started = useRef(false);
  const [desktop, setDesktop] = useState<DesktopState | undefined>(undefined);
  const [frame, setFrame] = useState<CompositionFrame | undefined>(undefined);
  const [views, setViews] = useState<ReadonlyMap<WidgetInstanceId, ClockView>>(new Map());
  const [hit, setHit] = useState<HitReadout | undefined>(undefined);
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [presentMs, setPresentMs] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const registry = buildRegistry(BUNDLED_THEME_DATA);
      for (const rejection of registry.rejected) {
        console.error(`Theme rejected (${rejection.source}): ${rejection.reason}`);
      }

      const accessibility = readAccessibility();
      const initialMode: ThemeMode = window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';

      const themes = createThemeController(registry, document.documentElement);
      const outcome = themes.apply({ themeId: DEFAULT_THEME_ID, mode: initialMode, accessibility });
      if (!outcome.ok) {
        console.error(`Theme could not be applied: ${outcome.reason}`);
        themes.restoreDefault(initialMode, accessibility);
      }

      const applied = themes.applied;
      if (!applied) return;

      const display = await fetchPrimaryDisplay({
        width: window.innerWidth,
        height: window.innerHeight,
      });

      const controller = new DesktopController({
        theme: applied,
        display,
        timer: createSystemTimer(),
        frameSource: (callback) => requestAnimationFrame(() => callback()),
        callbacks: {
          onFrame: (presented) => {
            const startedAt = performance.now();
            setFrame(presented);
            setPresentMs(performance.now() - startedAt);
          },
          onViews: setViews,
        },
        reducedTransparency: accessibility.reducedTransparency,
      });

      await controller.place(Date.now());
      setMode(initialMode);
      setDesktop({ controller, themes, accessibility });

      requestAnimationFrame(() => {
        controller.markPainted();
        void commands.shellReportFirstFrame().catch(() => undefined);
      });
    })();
  }, []);

  const onMode = (next: ThemeMode): void => {
    if (!desktop) return;

    const outcome = desktop.themes.apply({
      themeId: DEFAULT_THEME_ID,
      mode: next,
      accessibility: desktop.accessibility,
    });
    if (!outcome.ok) {
      console.error(`Theme could not be applied: ${outcome.reason}`);
      return;
    }

    const applied = desktop.themes.applied;
    if (applied) desktop.controller.applyTheme(applied);
    setMode(next);
  };

  if (!desktop) {
    return (
      <div
        data-devdesk-shell="loading"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0c0d12',
          color: '#a1a1aa',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        Initializing DevDesk Pipeline...
      </div>
    );
  }

  return (
    <div data-devdesk-shell="root">
      <NavigationBar
        mode={mode}
        onMode={onMode}
        displayName={`${desktop.controller.display.name} @ ${desktop.controller.display.scaleFactor}x`}
        hit={hit}
        frameCount={frame?.sequence ?? 0}
        presentMs={presentMs}
      />
      <DesktopRoot
        controller={desktop.controller}
        frame={frame}
        views={views}
        onHit={setHit}
      />
      <StatusDock />
    </div>
  );
}
