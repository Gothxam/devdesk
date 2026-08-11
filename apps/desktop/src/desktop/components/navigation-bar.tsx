/**
 * Stage 5A — Top Header & Pill Navigation Component
 */

import { useState } from 'react';
import type { ThemeMode } from '@devdesk/theme-engine';
import type { HitReadout } from '../desktop-root';

export interface NavigationBarProps {
  readonly mode: ThemeMode;
  readonly onMode: (mode: ThemeMode) => void;
  readonly displayName: string;
  readonly hit: HitReadout | undefined;
  readonly frameCount: number;
  readonly presentMs: number | undefined;
}

export function NavigationBar(props: NavigationBarProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'workspace' | 'clocks' | 'metrics' | 'specs'>('workspace');

  return (
    <header className="devdesk-header">
      {/* Left: Brand */}
      <div className="devdesk-brand">
        <div className="devdesk-logo">D</div>
        <span className="devdesk-title">DevDesk</span>
        <span className="devdesk-badge">v0.1.0</span>
        <div className="devdesk-pulse-status">
          <span className="devdesk-pulse-dot" />
          <span>Active</span>
        </div>
      </div>

      {/* Center: Nav Pills */}
      <div className="devdesk-nav-pills">
        {[
          { id: 'workspace', label: 'Workspace' },
          { id: 'clocks', label: 'Clocks' },
          { id: 'metrics', label: 'Metrics' },
          { id: 'specs', label: 'Specs' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`devdesk-nav-btn ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id as any)}
            >
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Right: Metrics & Theme Toggle */}
      <div className="devdesk-metrics-bar">
        <div className={`devdesk-chip ${props.hit?.surfaceId ? 'active' : ''}`}>
          hit: {props.hit ? (props.hit.surfaceId ?? 'desktop') : '—'}
        </div>
        <div className="devdesk-chip">
          {props.displayName}
        </div>
        <div className="devdesk-chip" style={{ color: '#10b981' }}>
          {props.presentMs !== undefined ? `${props.presentMs.toFixed(2)}ms` : '—'}
        </div>

        {/* Mode Switcher */}
        <div className="devdesk-mode-toggle">
          <button
            type="button"
            className={`devdesk-mode-btn ${props.mode === 'dark' ? 'active' : ''}`}
            onClick={() => props.onMode('dark')}
          >
            Dark
          </button>
          <button
            type="button"
            className={`devdesk-mode-btn ${props.mode === 'light' ? 'active' : ''}`}
            onClick={() => props.onMode('light')}
          >
            Light
          </button>
        </div>
      </div>
    </header>
  );
}
