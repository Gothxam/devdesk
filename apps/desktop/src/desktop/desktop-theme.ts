/**
 * Stage 7 — Materially Distinct Desktop Theme System Engine & Multi-Monitor Sync Bus
 *
 * Each theme defines a 100% distinct visual personality covering:
 * - Wallpaper canvas background treatment
 * - Surface card material CSS class (.theme-glass, .theme-acrylic, .theme-neon, .theme-matte, .theme-paper, .theme-amethyst)
 * - Typography font hierarchy
 * - Borders, specular highlights, and glowing shadows
 * - Motion profile curves (smooth, bouncy, snap, instant)
 */

export type MaterialStyle = 'glass' | 'acrylic' | 'matte' | 'paper' | 'transparent' | 'neon';
export type FontStyle = 'sans' | 'mono' | 'display';
export type ShadowPreset = 'none' | 'soft' | 'deep' | 'glowing';
export type MotionProfile = 'smooth' | 'bouncy' | 'snap' | 'none';

export interface DesktopThemeConfig {
  readonly id: string;
  readonly name: string;
  readonly materialStyle: MaterialStyle;
  readonly accentColor: string;
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly fontFamily: FontStyle;
  readonly borderRadius: number;
  readonly blurIntensity: number;
  readonly surfaceOpacity: number;
  readonly shadowPreset: ShadowPreset;
  readonly motionProfile: MotionProfile;
  readonly wallpaperBackground: string;
  readonly orbColors: {
    readonly primary: string;
    readonly secondary: string;
  };
}

export const PRESET_THEMES: readonly DesktopThemeConfig[] = [
  {
    id: 'obsidian-glass',
    name: '🌌 Obsidian Glass',
    materialStyle: 'glass',
    accentColor: '#6366f1',
    backgroundColor: 'rgba(14, 17, 26, 0.82)',
    textColor: '#f4f4f5',
    fontFamily: 'sans',
    borderRadius: 24,
    blurIntensity: 36,
    surfaceOpacity: 0.82,
    shadowPreset: 'deep',
    motionProfile: 'smooth',
    wallpaperBackground: 'radial-gradient(ellipse at 50% 25%, #15182a 0%, #0c0d16 55%, #030407 100%)',
    orbColors: {
      primary: 'rgba(99, 102, 241, 0.22)',
      secondary: 'rgba(16, 185, 129, 0.15)',
    },
  },
  {
    id: 'frosted-acrylic',
    name: '💎 Frosted Acrylic',
    materialStyle: 'acrylic',
    accentColor: '#38bdf8',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    textColor: '#f8fafc',
    fontFamily: 'sans',
    borderRadius: 20,
    blurIntensity: 50,
    surfaceOpacity: 0.65,
    shadowPreset: 'soft',
    motionProfile: 'smooth',
    wallpaperBackground: 'radial-gradient(ellipse at 70% 20%, #0f172a 0%, #080d1a 60%, #020408 100%)',
    orbColors: {
      primary: 'rgba(56, 189, 248, 0.25)',
      secondary: 'rgba(99, 102, 241, 0.2)',
    },
  },
  {
    id: 'cyberpunk-neon',
    name: '⚡ Cyberpunk Neon',
    materialStyle: 'neon',
    accentColor: '#ec4899',
    backgroundColor: 'rgba(10, 10, 15, 0.95)',
    textColor: '#ffffff',
    fontFamily: 'mono',
    borderRadius: 12,
    blurIntensity: 12,
    surfaceOpacity: 0.95,
    shadowPreset: 'glowing',
    motionProfile: 'snap',
    wallpaperBackground: 'radial-gradient(ellipse at 50% 50%, #1a0b1c 0%, #09040c 60%, #020104 100%)',
    orbColors: {
      primary: 'rgba(236, 72, 153, 0.35)',
      secondary: 'rgba(6, 182, 212, 0.35)',
    },
  },
  {
    id: 'midnight-matte',
    name: '🌑 Midnight Matte',
    materialStyle: 'matte',
    accentColor: '#10b981',
    backgroundColor: 'rgba(18, 20, 26, 0.98)',
    textColor: '#e4e4e7',
    fontFamily: 'sans',
    borderRadius: 14,
    blurIntensity: 0,
    surfaceOpacity: 0.98,
    shadowPreset: 'none',
    motionProfile: 'none',
    wallpaperBackground: 'radial-gradient(ellipse at 50% 30%, #171922 0%, #0d0e14 70%, #050508 100%)',
    orbColors: {
      primary: 'rgba(16, 185, 129, 0.12)',
      secondary: 'rgba(59, 130, 246, 0.1)',
    },
  },
  {
    id: 'minimal-paper',
    name: '📜 Minimal Paper',
    materialStyle: 'paper',
    accentColor: '#f59e0b',
    backgroundColor: 'rgba(28, 26, 24, 0.95)',
    textColor: '#fafafa',
    fontFamily: 'display',
    borderRadius: 10,
    blurIntensity: 4,
    surfaceOpacity: 0.95,
    shadowPreset: 'soft',
    motionProfile: 'smooth',
    wallpaperBackground: 'radial-gradient(ellipse at 40% 40%, #24211e 0%, #141210 65%, #080706 100%)',
    orbColors: {
      primary: 'rgba(245, 158, 11, 0.18)',
      secondary: 'rgba(239, 68, 68, 0.12)',
    },
  },
  {
    id: 'deep-amethyst',
    name: '🔮 Deep Amethyst',
    materialStyle: 'glass',
    accentColor: '#a855f7',
    backgroundColor: 'rgba(28, 16, 45, 0.85)',
    textColor: '#f5f3ff',
    fontFamily: 'sans',
    borderRadius: 28,
    blurIntensity: 36,
    surfaceOpacity: 0.85,
    shadowPreset: 'glowing',
    motionProfile: 'bouncy',
    wallpaperBackground: 'radial-gradient(ellipse at 60% 30%, #2d1245 0%, #150824 60%, #07020e 100%)',
    orbColors: {
      primary: 'rgba(168, 85, 247, 0.3)',
      secondary: 'rgba(236, 72, 153, 0.25)',
    },
  },
];

const THEME_STORAGE_KEY = 'devdesk_active_theme_v1';
const SYNC_CHANNEL_NAME = 'devdesk_theme_sync_bus';

/** Multi-monitor BroadcastChannel instance */
const broadcastBus =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(SYNC_CHANNEL_NAME)
    : null;

/** Helper to convert hex color to rgba */
function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  if (c.length === 6) {
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/** Applies CSS variables and theme class to document root based on theme config */
export function applyDesktopTheme(config: DesktopThemeConfig): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // Font family resolution
  const fontFamilyCss =
    config.fontFamily === 'mono'
      ? "'SF Mono', 'JetBrains Mono', ui-monospace, monospace"
      : config.fontFamily === 'display'
      ? "'Outfit', 'Inter', system-ui, sans-serif"
      : "'Inter', system-ui, -apple-system, sans-serif";

  // Shadow preset resolution
  let shadowCss = '0 24px 64px rgba(0, 0, 0, 0.55)';
  if (config.shadowPreset === 'none') shadowCss = '0 4px 12px rgba(0, 0, 0, 0.4)';
  if (config.shadowPreset === 'soft') shadowCss = '0 12px 32px rgba(0, 0, 0, 0.35)';
  if (config.shadowPreset === 'deep') shadowCss = '0 32px 80px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
  if (config.shadowPreset === 'glowing')
    shadowCss = `0 0 32px ${hexToRgba(config.accentColor, 0.5)}, 0 0 64px ${hexToRgba(config.accentColor, 0.25)}, 0 24px 64px rgba(0, 0, 0, 0.8)`;

  // Material border resolution
  let borderCss = '1px solid rgba(255, 255, 255, 0.1)';
  if (config.materialStyle === 'neon') borderCss = `2px solid ${config.accentColor}`;
  if (config.materialStyle === 'paper') borderCss = '1px solid rgba(245, 158, 11, 0.3)';
  if (config.materialStyle === 'transparent') borderCss = '1px solid rgba(255, 255, 255, 0.25)';
  if (config.materialStyle === 'matte') borderCss = '1px solid rgba(255, 255, 255, 0.08)';
  if (config.materialStyle === 'acrylic') borderCss = '1px solid rgba(255, 255, 255, 0.22)';

  // Accent derived variants
  const accentBg = hexToRgba(config.accentColor, 0.22);
  const accentBorder = hexToRgba(config.accentColor, 0.6);
  const accentGlow = `0 0 16px ${config.accentColor}`;

  // Motion Profile Token Mapping
  const motionProfile = config.motionProfile ?? 'smooth';
  let motionDuration = '0.22s';
  let motionEase = 'cubic-bezier(0.16, 1, 0.3, 1)';

  if (motionProfile === 'none') {
    motionDuration = '0.01s';
    motionEase = 'linear';
  } else if (motionProfile === 'bouncy') {
    motionDuration = '0.38s';
    motionEase = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  } else if (motionProfile === 'snap') {
    motionDuration = '0.14s';
    motionEase = 'cubic-bezier(0, 1, 0.5, 1)';
  }

  // Material CSS Class setting on <html> tag
  root.className = `theme-material-${config.materialStyle} theme-font-${config.fontFamily}`;

  root.style.setProperty('--devdesk-accent', config.accentColor);
  root.style.setProperty('--devdesk-accent-bg', accentBg);
  root.style.setProperty('--devdesk-accent-border', accentBorder);
  root.style.setProperty('--devdesk-accent-glow', accentGlow);
  root.style.setProperty('--devdesk-radius', `${config.borderRadius}px`);
  root.style.setProperty('--devdesk-blur', `${config.blurIntensity}px`);
  root.style.setProperty('--devdesk-bg', config.backgroundColor);
  root.style.setProperty('--devdesk-text', config.textColor);
  root.style.setProperty('--devdesk-font', fontFamilyCss);
  root.style.setProperty('--devdesk-shadow', shadowCss);
  root.style.setProperty('--devdesk-border', borderCss);
  root.style.setProperty('--devdesk-wallpaper-bg', config.wallpaperBackground || 'radial-gradient(ellipse at 50% 25%, #15182a 0%, #0c0d16 55%, #030407 100%)');
  root.style.setProperty('--devdesk-orb-1', config.orbColors.primary);
  root.style.setProperty('--devdesk-orb-2', config.orbColors.secondary);
  root.style.setProperty('--devdesk-motion-duration', motionDuration);
  root.style.setProperty('--devdesk-motion-ease', motionEase);
}

export const DEFAULT_THEME: DesktopThemeConfig = PRESET_THEMES[0] as DesktopThemeConfig;

/** Loads global active theme from localStorage or returns default */
export function loadActiveTheme(): DesktopThemeConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as DesktopThemeConfig;
    return parsed.id ? parsed : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Saves global active theme to localStorage and broadcasts to ALL active monitor webviews */
export function saveActiveTheme(config: DesktopThemeConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config));
    applyDesktopTheme(config);

    // BroadcastChannel sync to all other desktop host webview windows
    broadcastBus?.postMessage(config);
  } catch {
    // fallback
  }
}

/** Subscribes to real-time theme changes across ALL active monitor webview windows */
export function subscribeThemeChanges(callback: (theme: DesktopThemeConfig) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  // 1. Storage Event listener
  const handleStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY && e.newValue) {
      try {
        const theme = JSON.parse(e.newValue) as DesktopThemeConfig;
        if (theme.id) {
          applyDesktopTheme(theme);
          callback(theme);
        }
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener('storage', handleStorage);

  // 2. BroadcastChannel listener
  const handleBroadcast = (e: MessageEvent) => {
    if (e.data && typeof e.data === 'object' && e.data.id) {
      const theme = e.data as DesktopThemeConfig;
      applyDesktopTheme(theme);
      callback(theme);
    }
  };
  if (broadcastBus) {
    broadcastBus.addEventListener('message', handleBroadcast);
  }

  return () => {
    window.removeEventListener('storage', handleStorage);
    if (broadcastBus) {
      broadcastBus.removeEventListener('message', handleBroadcast);
    }
  };
}
