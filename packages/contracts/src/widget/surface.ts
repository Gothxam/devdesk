/**
 * The core's identities, as the shell sees them.
 *
 * `SurfaceId` and `MonitorId` are owned by the Rust core — `devdesk-core`
 * allocates the first, `devdesk-display` resolves the second. They cross IPC as
 * plain strings, and these are the branded views of them on this side.
 *
 * They are declared rather than generated because they are *arguments* to
 * commands rather than shapes returned by one, and specta types a `String`
 * parameter as `string`. Branding them here means a `SurfaceId` cannot be passed
 * where a `MonitorId` is expected, which is the mistake that would otherwise be
 * invisible until a lookup failed at runtime.
 *
 * The brand is a compile-time fiction. The wire sees a string, exactly as the
 * Rust side sends one.
 */

import { type Brand, brand, err, ok, type Result } from '@devdesk/shared';

/** A surface the core has registered. Process-local; never persisted. */
export type SurfaceId = Brand<string, 'SurfaceId'>;

/** A display the core has identified. Stable across sessions (`WD-3`). */
export type MonitorId = Brand<string, 'MonitorId'>;

/** Why an identity from the core was rejected. */
export type CoreIdentityError = { readonly kind: 'empty'; readonly field: string };

/**
 * Brands a surface identity received from the core.
 *
 * Validated even though it came from the trusted side. The core's `SurfaceId`
 * rejects an empty value for its own reasons, so an empty one arriving here
 * means the wire or the caller is wrong, and finding that out at the boundary
 * beats finding it out at a lookup.
 */
export function surfaceId(value: string): Result<SurfaceId, CoreIdentityError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return err({ kind: 'empty', field: 'surfaceId' });
  return ok(brand<string, 'SurfaceId'>(trimmed));
}

/** Brands a monitor identity received from the core. */
export function monitorId(value: string): Result<MonitorId, CoreIdentityError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return err({ kind: 'empty', field: 'monitorId' });
  return ok(brand<string, 'MonitorId'>(trimmed));
}
