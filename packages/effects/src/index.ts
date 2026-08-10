/**
 * `@devdesk/effects` — public surface.
 *
 * This file is the only importable entry point (DR-5). Anything not exported
 * here is internal, and `dependency-cruiser` enforces it.
 *
 * Owns the glass/blur compositing primitives (§6.2.2). `AP-3`: nothing outside
 * this package writes `backdrop-filter`. Budget accounting and automatic
 * degradation land here in M2 (`DD-010`); the primitive is a function so they
 * have a choke-point to hook.
 */

export { type GlassIntent, type GlassStyle, glassStyle, needsGlass } from './glass';
