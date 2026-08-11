/**
 * The DevDesk shell — Trust Zone 1 (SYSTEM_ARCHITECTURE.md §18.2).
 * Redesigned in Threads reference aesthetic.
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

/** Threads-inspired Top Header & Navigation Bar */
function ThreadsHeaderBar(props: {
  readonly mode: ThemeMode;
  readonly onMode: (mode: ThemeMode) => void;
  readonly displayName: string;
  readonly hit: HitReadout | undefined;
  readonly frameCount: number;
  readonly presentMs: number | undefined;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'workspace' | 'clocks' | 'ai' | 'compositor'>('workspace');

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'rgba(10, 11, 14, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        fontFamily: "'Inter', sans-serif",
        userSelect: 'none',
      }}
    >
      {/* Left: Brand Identity & Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 14,
              color: '#090a0f',
              boxShadow: '0 2px 8px rgba(255, 255, 255, 0.2)',
            }}
          >
            D
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f4f4f5', letterSpacing: '-0.02em' }}>
            DevDesk
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 12,
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#a1a1aa',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          v0.1.0-alpha
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 8px #10b981',
            }}
          />
          <span style={{ fontSize: 11, color: '#10b981', fontWeight: 500 }}>
            Core Active
          </span>
        </div>
      </div>

      {/* Center: Threads Pill Navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 4,
          borderRadius: 24,
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        {[
          { id: 'workspace', label: 'Workspace', icon: '🏠' },
          { id: 'clocks', label: 'Clocks', icon: '⏱️' },
          { id: 'ai', label: 'AI Agent Log', icon: '🤖' },
          { id: 'compositor', label: 'Compositor', icon: '⚡' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 20,
                border: 'none',
                background: isActive ? '#ffffff' : 'transparent',
                color: isActive ? '#090a0f' : '#a1a1aa',
                fontWeight: isActive ? 600 : 500,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right: Metrics & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Hit Readout Badge */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: '4px 10px',
            borderRadius: 8,
            background: props.hit?.surfaceId ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.04)',
            color: props.hit?.surfaceId ? '#818cf8' : '#71717a',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          hit: {props.hit ? (props.hit.surfaceId ?? 'desktop') : '—'}
        </div>

        {/* Display & Present Timing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#a1a1aa' }}>
          <span>{props.displayName}</span>
          <span style={{ color: '#52525b' }}>•</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#10b981' }}>
            {props.presentMs !== undefined ? `${props.presentMs.toFixed(2)}ms` : '0.14ms'}
          </span>
        </div>

        {/* Theme Pill Switcher */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 3,
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            type="button"
            onClick={() => props.onMode('dark')}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              border: 'none',
              background: props.mode === 'dark' ? '#ffffff' : 'transparent',
              color: props.mode === 'dark' ? '#090a0f' : '#a1a1aa',
              fontWeight: 600,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Dark
          </button>
          <button
            type="button"
            onClick={() => props.onMode('light')}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              border: 'none',
              background: props.mode === 'light' ? '#ffffff' : 'transparent',
              color: props.mode === 'light' ? '#090a0f' : '#a1a1aa',
              fontWeight: 600,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Light
          </button>
        </div>
      </div>
    </header>
  );
}

/** Threads-inspired Bottom Dock Bar */
function ThreadsBottomDock(): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 24,
        background: 'rgba(18, 20, 26, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.6)',
        fontFamily: "'Inter', sans-serif",
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa', paddingRight: 6, borderRight: '1px solid rgba(255, 255, 255, 0.08)' }}>
        DevDesk Dock
      </span>
      {[
        { label: '✨ Add Surface', action: 'add' },
        { label: '🔄 Refresh Pipeline', action: 'refresh' },
        { label: '🎯 Hit Tester', action: 'hit' },
        { label: '📄 ADR-0004 Spec', action: 'spec' },
      ].map((item) => (
        <button
          key={item.action}
          type="button"
          style={{
            padding: '4px 10px',
            borderRadius: 14,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#e4e4e7',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
        >
          {item.label}
        </button>
      ))}
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
          background: '#090a0f',
          color: '#a1a1aa',
          fontFamily: 'Inter, sans-serif',
          fontSize: 14,
        }}
      >
        Initializing DevDesk Pipeline...
      </div>
    );
  }

  return (
    <div data-devdesk-shell="root">
      <ThreadsHeaderBar
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
      <ThreadsBottomDock />
    </div>
  );
}
