/**
 * What widgets exist.
 *
 * ## Pure, and what that buys
 *
 * The registry knows nothing about rendering, windows, React, the DOM, or the
 * core. It is a validated map from {@link WidgetId} to {@link WidgetManifest},
 * and every question it answers is answerable from its own contents.
 *
 * That is worth insisting on because the registry is what the widget picker, the
 * arrangement restorer, and the M3 plugin loader will all consult. If it could
 * render, restoring an arrangement would paint; if it could open windows,
 * enumerating for a settings list would create them. Each of those is a bug that
 * only appears in the caller nobody thought about.
 *
 * ## Immutable
 *
 * Registering returns a *new* registry rather than mutating this one, matching
 * the immutable-snapshot shape the display subsystem uses (`WD-11`). A caller
 * holding a registry can iterate it across arbitrary work and know the set did
 * not change underneath — which the widget picker needs, because a widget
 * registered mid-render would otherwise appear halfway down a list.
 *
 * Startup folds over the built-in manifests once; nothing registers per frame,
 * so the allocation is irrelevant and the guarantee is not.
 */

import {
  describeManifestError,
  type ManifestError,
  parseWidgetManifest,
  type WidgetId,
  type WidgetManifest,
} from '@devdesk/contracts';
import { err, ok, type Result } from '@devdesk/shared';

/** Why a manifest was not registered. */
export type RegistrationError =
  | { readonly kind: 'invalid-manifest'; readonly problems: readonly ManifestError[] }
  | { readonly kind: 'already-registered'; readonly id: WidgetId };

/** Why a widget could not be removed. */
export type UnregistrationError = { readonly kind: 'not-registered'; readonly id: WidgetId };

/** The set of widgets the runtime knows about. */
export interface WidgetRegistry {
  /**
   * Validates a manifest and returns a registry containing it.
   *
   * Takes `unknown` because a manifest arrives from a file or a bundle. There is
   * no overload that skips validation — that overload is how first-party code
   * acquires a privileged path, and `DD-008` forbids one.
   */
  readonly register: (manifest: unknown) => Result<WidgetRegistry, RegistrationError>;

  /** Returns a registry without this widget. */
  readonly unregister: (id: WidgetId) => Result<WidgetRegistry, UnregistrationError>;

  /** The manifest for a widget, if it is registered. */
  readonly lookup: (id: WidgetId) => WidgetManifest | undefined;

  readonly has: (id: WidgetId) => boolean;

  /**
   * Every registered manifest, ordered by widget id.
   *
   * Ordered by identity rather than by registration order for the reason
   * `WD-3` gives for monitors: registration order is an accident of startup
   * timing, and a picker that listed widgets by it would reorder itself between
   * launches for no reason the user could see.
   */
  readonly enumerate: () => readonly WidgetManifest[];

  readonly size: number;
}

/** Validates a manifest without registering it. */
export function validateManifest(
  manifest: unknown,
): Result<WidgetManifest, readonly ManifestError[]> {
  return parseWidgetManifest(manifest);
}

/** Renders a registration failure as something an author can act on. */
export function describeRegistrationError(error: RegistrationError): string {
  switch (error.kind) {
    case 'already-registered':
      return `a widget with id "${error.id}" is already registered`;
    case 'invalid-manifest':
      return error.problems.map(describeManifestError).join('; ');
  }
}

function build(entries: ReadonlyMap<WidgetId, WidgetManifest>): WidgetRegistry {
  const registry: WidgetRegistry = {
    register(manifest: unknown) {
      const parsed = parseWidgetManifest(manifest);
      if (!parsed.ok) return err({ kind: 'invalid-manifest', problems: parsed.error });

      if (entries.has(parsed.value.id)) {
        // Refused rather than replaced. A silent replacement means two authors
        // shipped the same id and the winner is whoever loaded last — which
        // changes between launches, and takes every placed instance with it.
        return err({ kind: 'already-registered', id: parsed.value.id });
      }

      const next = new Map(entries);
      next.set(parsed.value.id, parsed.value);
      return ok(build(next));
    },

    unregister(id: WidgetId) {
      if (!entries.has(id)) return err({ kind: 'not-registered', id });

      const next = new Map(entries);
      next.delete(id);
      return ok(build(next));
    },

    lookup: (id) => entries.get(id),
    has: (id) => entries.has(id),

    enumerate: () =>
      Object.freeze(
        [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ),

    size: entries.size,
  };

  return Object.freeze(registry);
}

/** An empty registry. */
export function createWidgetRegistry(): WidgetRegistry {
  return build(new Map());
}

/** The outcome of registering several manifests at once. */
export interface BulkRegistration {
  readonly registry: WidgetRegistry;
  /** Every manifest that was refused, with the reason. */
  readonly rejected: readonly { readonly manifest: unknown; readonly error: RegistrationError }[];
}

/**
 * Registers many manifests, keeping the ones that are valid.
 *
 * A bad manifest does not stop the others. This is startup: one malformed
 * third-party widget must not take the desktop down with it (`AC-ERR-2.2`), and
 * a caller that would rather fail hard can check `rejected` and do so.
 */
export function registerAll(
  registry: WidgetRegistry,
  manifests: readonly unknown[],
): BulkRegistration {
  const rejected: { manifest: unknown; error: RegistrationError }[] = [];
  let current = registry;

  for (const manifest of manifests) {
    const result = current.register(manifest);
    if (result.ok) current = result.value;
    else rejected.push({ manifest, error: result.error });
  }

  return Object.freeze({ registry: current, rejected: Object.freeze(rejected) });
}
