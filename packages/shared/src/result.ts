/**
 * `Result` — the explicit success-or-failure type (§6.2.2).
 *
 * Errors are values (EM-1). A function that can fail says so in its type, and
 * the caller cannot reach the value without acknowledging the failure. This is
 * the TypeScript counterpart of the Rust `Result` the core returns across the
 * IPC boundary, and it is deliberately the same shape as the generated contract's
 * error envelope so that neither side needs a translation layer.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wraps a value as a successful `Result`. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wraps an error as a failed `Result`. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Narrows a `Result` to its success branch. */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/** Narrows a `Result` to its failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
