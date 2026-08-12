/**
 * Stage 6 — Desktop Theme Picker & Customizer Drawer
 * Features live preset selection, real-time material tweaking, JSON import/export, and CSS token application.
 */

import { useState } from 'react';
import {
  PRESET_THEMES,
  type DesktopThemeConfig,
  type FontStyle,
  type MaterialStyle,
  type ShadowPreset,
} from '../desktop-theme';

export interface ThemePickerProps {
  readonly isOpen: boolean;
  readonly activeTheme: DesktopThemeConfig;
  readonly onClose: () => void;
  readonly onApplyTheme: (theme: DesktopThemeConfig) => void;
}

export function ThemePicker(props: ThemePickerProps): React.JSX.Element | null {
  if (!props.isOpen) return null;

  const { activeTheme, onClose, onApplyTheme } = props;
  const [activeTab, setActiveTab] = useState<'presets' | 'customizer' | 'port'>('presets');
  const [draft, setDraft] = useState<DesktopThemeConfig>(activeTheme);

  const updateDraft = (patch: Partial<DesktopThemeConfig>) => {
    const updated = { ...draft, ...patch };
    setDraft(updated);
    onApplyTheme(updated);
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(draft, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${draft.id || 'custom'}-theme.devdesk.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as DesktopThemeConfig;
        if (parsed.id && parsed.materialStyle) {
          updateDraft(parsed);
        }
      } catch {
        alert('Invalid DevDesk theme JSON format.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
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
          background: 'rgba(15, 18, 28, 0.94)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 32px 90px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#f4f4f5',
          fontFamily: "'Inter', system-ui, sans-serif",
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
            <span style={{ fontSize: 20 }}>🎨</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                Desktop Theme Engine
              </div>
              <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                Token-driven material customization & dynamic presets
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
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Tab Bar */}
        <div
          style={{
            padding: '8px 24px',
            background: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            style={{
              padding: '6px 16px',
              borderRadius: 10,
              border: 'none',
              background: activeTab === 'presets' ? '#6366f1' : 'transparent',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Presets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('customizer')}
            style={{
              padding: '6px 16px',
              borderRadius: 10,
              border: 'none',
              background: activeTab === 'customizer' ? '#6366f1' : 'transparent',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Customizer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('port')}
            style={{
              padding: '6px 16px',
              borderRadius: 10,
              border: 'none',
              background: activeTab === 'port' ? '#6366f1' : 'transparent',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Import / Export
          </button>
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          {activeTab === 'presets' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {PRESET_THEMES.map((theme) => {
                const isSelected = draft.id === theme.id;
                return (
                  <div
                    key={theme.id}
                    onClick={() => updateDraft(theme)}
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      border: isSelected
                        ? '2px solid #818cf8'
                        : '1px solid rgba(255, 255, 255, 0.12)',
                      background: theme.backgroundColor,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      boxShadow: isSelected ? '0 0 20px rgba(99, 102, 241, 0.4)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{theme.name}</span>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: theme.accentColor,
                          boxShadow: `0 0 8px ${theme.accentColor}`,
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                      Material: <span style={{ color: '#818cf8', fontWeight: 600 }}>{theme.materialStyle}</span> · Blur: {theme.blurIntensity}px
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'customizer' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Material Style */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>
                  Material Surface Style
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['glass', 'acrylic', 'matte', 'paper', 'transparent', 'neon'] as MaterialStyle[]).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => updateDraft({ materialStyle: style })}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 10,
                        border: draft.materialStyle === style ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.1)',
                        background: draft.materialStyle === style ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                      }}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent Color */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>
                  Accent Color
                </label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {['#6366f1', '#10b981', '#ec4899', '#06b6d4', '#f59e0b', '#a855f7'].map((hex) => (
                    <div
                      key={hex}
                      onClick={() => updateDraft({ accentColor: hex })}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: hex,
                        border: draft.accentColor === hex ? '2px solid #ffffff' : 'none',
                        cursor: 'pointer',
                        boxShadow: `0 0 10px ${hex}`,
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={draft.accentColor}
                    onChange={(e) => updateDraft({ accentColor: e.target.value })}
                    style={{ background: 'transparent', border: 'none', width: 28, height: 28, cursor: 'pointer' }}
                  />
                </div>
              </div>

              {/* Radius Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 6 }}>
                  <span>Corner Radius</span>
                  <span>{draft.borderRadius}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  value={draft.borderRadius}
                  onChange={(e) => updateDraft({ borderRadius: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: '#6366f1' }}
                />
              </div>

              {/* Blur Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 6 }}>
                  <span>Backdrop Blur Intensity</span>
                  <span>{draft.blurIntensity}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={draft.blurIntensity}
                  onChange={(e) => updateDraft({ blurIntensity: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: '#6366f1' }}
                />
              </div>

              {/* Font Family */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>
                  Typography Font
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['sans', 'mono', 'display'] as FontStyle[]).map((font) => (
                    <button
                      key={font}
                      type="button"
                      onClick={() => updateDraft({ fontFamily: font })}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 10,
                        border: draft.fontFamily === font ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.1)',
                        background: draft.fontFamily === font ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                      }}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shadow Preset */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>
                  Shadow Style
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['none', 'soft', 'deep', 'glowing'] as ShadowPreset[]).map((sh) => (
                    <button
                      key={sh}
                      type="button"
                      onClick={() => updateDraft({ shadowPreset: sh })}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 10,
                        border: draft.shadowPreset === sh ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.1)',
                        background: draft.shadowPreset === sh ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                      }}
                    >
                      {sh}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'port' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.5 }}>
                Export your custom theme configuration as JSON or import an existing theme file.
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={handleExportJson}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 12,
                    background: '#6366f1',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  📤 Export Theme JSON
                </button>

                <label
                  style={{
                    padding: '10px 18px',
                    borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  📥 Import Theme JSON
                  <input type="file" accept=".json" onChange={handleImportJson} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
