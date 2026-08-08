/**
 * Content hashing for snapshots.
 *
 * The hash identifies the *inputs* that produced a snapshot: theme content,
 * mode, and accessibility preferences. Two snapshots with equal hashes are
 * interchangeable, which lets {@link diffSnapshots} short-circuit even when the
 * two came from different pools — identity is a fast path, the hash is the
 * general one.
 */

import type { AccessibilityPreferences } from './preferences';
import { type ThemeMode, type ThemeSource, declaredTokens } from './token';

/** FNV-1a over the inputs that determine a snapshot. */
export function hashThemeInputs(
  source: ThemeSource,
  mode: ThemeMode,
  accessibility: AccessibilityPreferences,
): string {
  let hash = 0x811c9dc5;

  const push = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };

  push(source.id);
  push(' ');
  push(mode);
  push(' ');
  push(String(accessibility.reducedMotion));
  push(String(accessibility.reducedTransparency));
  push(String(accessibility.highContrast));

  const set = source.modes[mode];
  if (set !== undefined) {
    // Sorted, so key order in the source cannot produce two hashes for one theme.
    for (const [id, definition] of [...declaredTokens(set)].sort(([a], [b]) => (a < b ? -1 : 1))) {
      push(' ');
      push(id);
      push(definition.kind);
      push(
        definition.value.form === 'literal'
          ? definition.value.value
          : `→${definition.value.to}|${definition.value.fallback ?? ''}`,
      );
    }
  }

  return hash.toString(16).padStart(8, '0');
}
