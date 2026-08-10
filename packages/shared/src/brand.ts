/**
 * Nominal typing over primitives.
 *
 * A `SurfaceId` and a `WidgetId` are both strings, and TypeScript will happily
 * pass one where the other is expected. That mistake is invisible at every layer
 * until something looks up an identity that was never registered — by which
 * point the call site that swapped them is far away.
 *
 * The brand exists only in the type system. At runtime the value *is* the
 * primitive: it serialises as a plain string, crosses IPC as a plain string, and
 * costs nothing. DR-3 keeps this package free of runtime dependencies, and this
 * file adds no code at all beyond one identity function.
 */

declare const BRAND: unique symbol;

/** A primitive tagged with a name that only the type system can see. */
export type Brand<T, Name extends string> = T & { readonly [BRAND]: Name };

/**
 * Applies a brand.
 *
 * Deliberately unchecked and deliberately not exported as a general-purpose
 * cast: each branded type owns a constructor that validates its own rules
 * first, and this is what that constructor calls once it has. A caller reaching
 * for this directly has skipped the validation the brand is meant to attest.
 *
 * @internal
 */
export function brand<T, Name extends string>(value: T): Brand<T, Name> {
  return value as Brand<T, Name>;
}
