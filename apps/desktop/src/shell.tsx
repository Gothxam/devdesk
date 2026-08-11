/**
 * The DevDesk shell — Trust Zone 1 (SYSTEM_ARCHITECTURE.md §18.2).
 *
 * The runtime integration checkpoint: every subsystem built so far, mounted.
 *
 * ```text
 *  theme controller ──ThemeSnapshot──▶ DesktopController ──frames──▶ DesktopRoot
 *  display_describe ──ShellDisplay──▶        │
 *  RAF + system timer ───────────────▶       └──views──▶ clock faces
 * ```
 *
 * Startup order is the reveal discipline end to end: build everything, render
 * the first frame, and only *then* reveal — the composed surfaces in the scene,
 * and in Tauri mode the shell window itself (`shell_report_first_frame`). A
 * desktop that appears is one that has already painted.
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

/** The prototype's control strip: theme switching and pipeline readouts. */
function ControlStrip(props: {
  readonly mode: ThemeMode;
  readonly onMode: (mode: ThemeMode) => void;
  readonly displayName: string;
  readonly hit: HitReadout | undefined;
  readonly frameCount: number;
  readonly presentMs: number | undefined;
}): React.JSX.Element {
  const button = (mode: ThemeMode): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--color-accent, #7aa2ff)',
    background: props.mode === mode ? 'var(--color-accent, #7aa2ff)' : 'transparent',
    color: props.mode === mode ? 'var(--color-canvas, #101216)' : 'var(--color-ink, #f2f4f8)',
    cursor: 'pointer',
    font: '12px system-ui',
  });

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1000,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 10,
        color: 'var(--color-ink, #f2f4f8)',
        background: 'rgba(0,0,0,0.35)',
        font: '12px system-ui',
      }}
    >
      <button type="button" style={button('dark')} onClick={() => props.onMode('dark')}>
        Dark
      </button>
      <button type="button" style={button('light')} onClick={() => props.onMode('light')}>
        Light
      </button>
      <span style={{ opacity: 0.75 }}>{props.displayName}</span>
      <span style={{ opacity: 0.75 }}>
        hit: {props.hit ? (props.hit.surfaceId ?? 'desktop') : '—'}
      </span>
      <span style={{ opacity: 0.75 }}>
        frames: {props.frameCount}
        {props.presentMs !== undefined ? ` · ${props.presentMs.toFixed(2)} ms` : ''}
      </span>
    </div>
  );
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
    // StrictMode double-invokes effects in dev; the pipeline must exist once.
    if (started.current) return;
    started.current = true;

    void (async () => {
      const registry = buildRegistry(BUNDLED_THEME_DATA);
      for (const rejection of registry.rejected) {
        // P-9: a theme that failed to load says so.
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
            // Present-to-commit is measured by React's own pass; what we can
            // report synchronously is the presenter's cost. The full number is
            // the benchmark's job (C50); this readout is a live sanity check.
            setPresentMs(performance.now() - startedAt);
          },
          onViews: setViews,
        },
        reducedTransparency: accessibility.reducedTransparency,
      });

      await controller.place(Date.now());
      setMode(initialMode);
      setDesktop({ controller, themes, accessibility });

      // Reveal after the first real paint: the next frame callback runs once
      // the browser has painted the scene React just committed.
      requestAnimationFrame(() => {
        controller.markPainted();
        // Tauri mode: show the (hidden) shell window. Browser mode: no runtime,
        // the call rejects, and there is nothing to reveal anyway.
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
    return <div data-devdesk-shell="loading" />;
  }

  return (
    <div data-devdesk-shell="root">
      <DesktopRoot
        controller={desktop.controller}
        frame={frame}
        views={views}
        onHit={setHit}
      />
      <ControlStrip
        mode={mode}
        onMode={onMode}
        displayName={`${desktop.controller.display.name} @ ${desktop.controller.display.scaleFactor}x`}
        hit={hit}
        frameCount={frame?.sequence ?? 0}
        presentMs={presentMs}
      />
    </div>
  );
}
