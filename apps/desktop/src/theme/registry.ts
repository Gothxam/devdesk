/**
 * The bundled theme registry.
 *
 * Themes are loaded as data (TH-1) and validated at the boundary before use
 * (SEC-2). A theme that fails validation is reported and excluded; it never
 * partially applies (`AC-THM-7.4`).
 *
 * Bundling the JSON is a Sprint 1 convenience. Runtime loading from
 * `$APPDATA/themes` belongs to the storage subsystem and arrives with it; the
 * validation boundary here does not change when the source does.
 */

import {
  type ThemeSource,
  describeThemeParseError,
  parseThemeSource,
} from '@devdesk/theme-engine';

import defaultThemeJson from '../../../../themes/devdesk-default/theme.json';
import slateThemeJson from '../../../../themes/devdesk-slate/theme.json';

/** The theme applied on first run and restored by `restoreDefault` (`AC-THM-4.2`). */
export const DEFAULT_THEME_ID = 'devdesk.default';

export interface ThemeRegistry {
  readonly themes: readonly ThemeSource[];
  /** Themes that failed validation, with an author-actionable reason (EM-6). */
  readonly rejected: readonly { readonly source: string; readonly reason: string }[];
}

/** Validates every bundled theme. Pure: takes the raw data, returns the outcome. */
export function buildRegistry(
  raw: readonly { readonly source: string; readonly data: unknown }[],
): ThemeRegistry {
  const themes: ThemeSource[] = [];
  const rejected: { source: string; reason: string }[] = [];

  for (const entry of raw) {
    const parsed = parseThemeSource(entry.data);
    if (parsed.ok) {
      themes.push(parsed.value);
    } else {
      rejected.push({ source: entry.source, reason: describeThemeParseError(parsed.error) });
    }
  }

  return { themes, rejected };
}

/** The bundled themes, as raw data awaiting validation. */
export const BUNDLED_THEME_DATA: readonly { source: string; data: unknown }[] = [
  { source: 'themes/devdesk-default', data: defaultThemeJson },
  { source: 'themes/devdesk-slate', data: slateThemeJson },
];

/** Finds a theme by id. */
export function findTheme(registry: ThemeRegistry, id: string): ThemeSource | undefined {
  return registry.themes.find((theme) => theme.id === id);
}
