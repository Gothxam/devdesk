/**
 * Runtime theme switching.
 *
 * Holds the current snapshot and drives the pipeline on every change. Switching
 * a theme, a mode, or an accessibility preference is one operation: resolve,
 * diff against what is currently applied, emit, apply.
 *
 * Because snapshots are interned, re-applying the current selection produces an
 * empty diff and touches nothing (`AC-THM-2.3`). Because the diff is against the
 * *applied* snapshot rather than a remembered selection, the DOM cannot drift
 * from what the controller believes is applied.
 */

import {
  type AccessibilityPreferences,
  type ResolutionError,
  type ThemeMode,
  type ThemeSnapshot,
  type ThemeSource,
  createSnapshotPool,
  describeResolutionError,
  diffSnapshots,
  emitDiff,
} from '@devdesk/theme-engine';

import { applyPatch } from './apply';
import { DEFAULT_THEME_ID, type ThemeRegistry, findTheme } from './registry';

export interface ThemeSelection {
  readonly themeId: string;
  readonly mode: ThemeMode;
  readonly accessibility: AccessibilityPreferences;
}

export interface ThemeController {
  /** Applies a selection. Returns the failure reason if the theme cannot resolve. */
  apply(selection: ThemeSelection): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /** Restores the default bundled theme in one action (`AC-THM-4.2`). */
  restoreDefault(mode: ThemeMode, accessibility: AccessibilityPreferences): void;
  /** The snapshot currently applied to the document, if any. */
  readonly applied: ThemeSnapshot | undefined;
}

export function createThemeController(registry: ThemeRegistry, root: HTMLElement): ThemeController {
  const pool = createSnapshotPool();
  let applied: ThemeSnapshot | undefined;

  function commit(source: ThemeSource, selection: ThemeSelection): ResolutionError | undefined {
    const resolved = pool.resolve(source, {
      mode: selection.mode,
      accessibility: selection.accessibility,
    });
    if (!resolved.ok) return resolved.error;

    applyPatch(emitDiff(diffSnapshots(applied, resolved.value)), root);
    applied = resolved.value;
    return undefined;
  }

  return {
    apply(selection) {
      const source = findTheme(registry, selection.themeId);
      if (source === undefined) {
        return { ok: false, reason: `No installed theme has the id "${selection.themeId}".` };
      }
      const failure = commit(source, selection);
      return failure === undefined
        ? { ok: true }
        : { ok: false, reason: describeResolutionError(failure) };
    },

    restoreDefault(mode, accessibility) {
      const fallback = findTheme(registry, DEFAULT_THEME_ID);
      if (fallback === undefined) {
        // P-10: there is always a way back. If the default is missing the build
        // is broken, and saying so beats leaving a half-themed desktop.
        throw new Error(
          `The default theme "${DEFAULT_THEME_ID}" is missing from this build. Reinstall DevDesk.`,
        );
      }
      commit(fallback, { themeId: DEFAULT_THEME_ID, mode, accessibility });
    },

    get applied() {
      return applied;
    },
  };
}
