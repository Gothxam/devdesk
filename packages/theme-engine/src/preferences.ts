/**
 * Operating-system accessibility preferences.
 *
 * A foundational type rather than part of resolution: hashing, resolution, and
 * the override table all need it, and putting it in any one of them makes the
 * other two depend on that one. It lives here so the module graph stays acyclic
 * (DR-1).
 */

/** Preferences that override theme values unconditionally (D-5, TH-5). */
export interface AccessibilityPreferences {
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
  readonly highContrast: boolean;
}

/** No preference active. */
export const NO_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = Object.freeze({
  reducedMotion: false,
  reducedTransparency: false,
  highContrast: false,
});
