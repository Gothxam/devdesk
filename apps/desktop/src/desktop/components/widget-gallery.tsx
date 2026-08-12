/**
 * Stage 7A — Widget Gallery & Add Widget Component
 * Discovers real available widget definitions and adds them to the desktop placement grid.
 * Architecture Invariant: Uses real widget IDs, no fake widgets or dummy runtimes.
 */

import { useState } from 'react';
import type { WidgetPlacementRecord } from '../layout-store';

export interface WidgetCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly category: 'Time' | 'Productivity' | 'System';
}

export const REAL_WIDGET_CATALOG: readonly WidgetCatalogItem[] = [
  {
    id: 'devdesk.clock',
    name: 'Digital Clock',
    description: 'Real-time precision digital clock with date readout and seconds tick.',
    icon: '⏰',
    defaultWidth: 320,
    defaultHeight: 180,
    category: 'Time',
  },
  {
    id: 'devdesk.calendar',
    name: 'Month Calendar',
    description: 'Interactive month grid calendar highlighting current day and schedule.',
    icon: '📅',
    defaultWidth: 340,
    defaultHeight: 220,
    category: 'Productivity',
  },
  {
    id: 'devdesk.session',
    name: 'Session Uptime',
    description: 'Active DevDesk session uptime counter with live cadence tracking.',
    icon: '⏱️',
    defaultWidth: 300,
    defaultHeight: 160,
    category: 'Time',
  },
  {
    id: 'devdesk.system',
    name: 'System Telemetry',
    description: 'Real runtime process metrics, CPU/Memory telemetry, and wakeups count.',
    icon: '💻',
    defaultWidth: 320,
    defaultHeight: 160,
    category: 'System',
  },
  {
    id: 'devdesk.activity',
    name: 'Activity Stream',
    description: 'Compositor frame rates, event cadence, and surface invalidation stream.',
    icon: '📊',
    defaultWidth: 320,
    defaultHeight: 160,
    category: 'System',
  },
];

export interface WidgetGalleryProps {
  readonly isOpen: boolean;
  readonly existingPlacements: ReadonlyMap<string, WidgetPlacementRecord>;
  readonly onClose: () => void;
  readonly onAddWidget: (item: WidgetCatalogItem) => void;
}

export function WidgetGallery(props: WidgetGalleryProps): React.JSX.Element | null {
  if (!props.isOpen) return null;

  const { existingPlacements, onClose, onAddWidget } = props;
  const [selectedCategory, setSelectedCategory] = useState<'All' | 'Time' | 'Productivity' | 'System'>('All');

  const filtered = selectedCategory === 'All'
    ? REAL_WIDGET_CATALOG
    : REAL_WIDGET_CATALOG.filter((w) => w.category === selectedCategory);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2400,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        userSelect: 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '85vh',
          borderRadius: 24,
          background: 'var(--devdesk-bg)',
          border: 'var(--devdesk-border)',
          boxShadow: 'var(--devdesk-shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: 'var(--devdesk-text)',
          fontFamily: 'var(--devdesk-font)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                Widget Gallery
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Discover real runtime widgets and add them to your desktop space
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.12)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--devdesk-text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Category Filters */}
        <div
          style={{
            padding: '8px 24px',
            background: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {(['All', 'Time', 'Productivity', 'System'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              style={{
                padding: '6px 16px',
                borderRadius: 10,
                border: 'none',
                background: selectedCategory === cat ? 'var(--devdesk-accent)' : 'transparent',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Gallery Grid */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map((item) => {
            // Count instances of this widget on desktop
            const count = Array.from(existingPlacements.keys()).filter((k) => k.startsWith(item.id)).length;

            return (
              <div
                key={item.id}
                style={{
                  padding: 16,
                  borderRadius: 18,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      background: 'var(--devdesk-accent-bg)',
                      border: '1px solid var(--devdesk-accent-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                    }}
                  >
                    {item.icon}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</span>
                      {count > 0 && (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'var(--devdesk-accent-bg)', color: 'var(--devdesk-accent)', fontWeight: 600 }}>
                          {count} on desktop
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                      {item.description}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onAddWidget(item);
                    onClose();
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 12,
                    background: 'var(--devdesk-accent)',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px var(--devdesk-accent-border)',
                  }}
                >
                  ➕ Add Widget
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
