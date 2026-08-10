/**
 * `@devdesk/shared` — public surface.
 *
 * This file is the only importable entry point (DR-5). Anything not exported
 * here is internal, and `dependency-cruiser` enforces it.
 *
 * DR-3: this package has zero runtime dependencies and no React, DOM, or Tauri
 * imports. It is published (PK-1), so a runtime dependency added here becomes a
 * transitive dependency of every plugin ever written (PK-5).
 */

export { type Result, ok, err, isOk, isErr } from './result';
export { type Brand, brand } from './brand';
