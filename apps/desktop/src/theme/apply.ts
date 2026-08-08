/**
 * The DOM stage of the theme pipeline.
 *
 * ```text
 * ThemeSource -> ThemeSnapshot -> ThemeDiff -> CustomPropertyPatch -> DOM
 * ```
 *
 * This module is the only place in the application that writes theme values to a
 * document, and it accepts only a patch. It cannot be handed a snapshot, because
 * the engine exposes no snapshot-to-DOM path — the shape of the API is the
 * enforcement.
 *
 * TH-4: switching re-emits custom properties on the root. Nothing remounts, so
 * surface content, scroll position, and input focus survive a theme change
 * (`AC-THM-3.2`).
 */

import type { CustomPropertyPatch } from '@devdesk/theme-engine';

/** Applies a patch to a document root. */
export function applyPatch(patch: CustomPropertyPatch, root: HTMLElement): void {
  for (const [property, value] of Object.entries(patch.set)) {
    root.style.setProperty(property, value);
  }
  // Removed rather than blanked: a stale property left behind is a value the
  // user did not choose, still rendering.
  for (const property of patch.remove) {
    root.style.removeProperty(property);
  }
}
