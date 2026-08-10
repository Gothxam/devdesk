/**
 * The one glass primitive.
 *
 * ## Why this is the only place `backdrop-filter` is written
 *
 * `AP-3` names ad-hoc `backdrop-filter` a recurring failure: it is the
 * platform's dominant GPU cost, and scattered uses cannot be accounted, budgeted,
 * or degraded together. §6.2.2 therefore gives the compositing primitives to
 * this package, and `DD-010`'s budget accounting lands here in M2 — one
 * choke-point to instrument rather than a codebase to sweep.
 *
 * The compositor expresses *intent* — opacity, blur radius, tint — and this
 * turns intent into CSS. Nothing else should.
 *
 * ## Deliberately not implemented here
 *
 * Cost accounting and automatic degradation are M2 (`SPRINT_1.md` §8). This
 * function is where the accounting will hook, which is the reason it exists as
 * a function rather than as inline styles at the call sites.
 */

/** The compositor's intent for one surface, as this package consumes it. */
export interface GlassIntent {
  /** `0` transparent, `1` opaque. */
  readonly opacity: number;
  /** Backdrop blur radius in logical pixels. `0` means none. */
  readonly blurRadius: number;
  /** Colour over the blurred backdrop, or `undefined` for none. */
  readonly tint: string | undefined;
}

/** CSS custom properties for one surface's glass, ready to set on its root. */
export interface GlassStyle {
  readonly ['--surface-opacity']: string;
  readonly ['--surface-backdrop']: string;
  readonly ['--surface-tint']: string;
}

/**
 * Turns intent into the custom properties a surface root consumes.
 *
 * Custom properties rather than direct styles for the same reason the theme
 * emits them (`TH-4`): the surface's own stylesheet decides *where* the values
 * apply, and this package decides *what* they are. `none` rather than an empty
 * string when there is no blur, because an empty `backdrop-filter` is invalid
 * and the property would be ignored — leaving whatever was there before.
 */
export function glassStyle(intent: GlassIntent): GlassStyle {
  const opacity = Number.isFinite(intent.opacity)
    ? Math.min(1, Math.max(0, intent.opacity))
    : 1;
  const blur = Number.isFinite(intent.blurRadius) ? Math.max(0, intent.blurRadius) : 0;

  return Object.freeze({
    '--surface-opacity': String(opacity),
    '--surface-backdrop': blur > 0 ? `blur(${blur}px)` : 'none',
    '--surface-tint': intent.tint ?? 'transparent',
  });
}

/**
 * Whether this intent involves the compositor at all.
 *
 * An opaque, unblurred, untinted surface needs no glass and should not pay for
 * the layer a `backdrop-filter` forces. The M2 budget accounting will count
 * exactly the surfaces where this is `true`.
 */
export function needsGlass(intent: GlassIntent): boolean {
  return intent.opacity < 1 || intent.blurRadius > 0 || intent.tint !== undefined;
}
