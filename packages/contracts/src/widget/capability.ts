/**
 * What a widget declares it needs.
 *
 * ## Declared now, enforced in M3
 *
 * There is no capability gate yet — `SYSTEM_ARCHITECTURE.md` §11.5 owns it and
 * `planning/SPRINT_1.md` §8 puts it in M3. Nothing in this file grants,
 * withholds, or checks anything, and the runtime does not consult it.
 *
 * It exists now for one reason: **the field has to be in the manifest before any
 * manifest is written.** `AC-FRE-6.1` and `AC-WGT-8.3` require the first-party
 * widgets to request *zero* capabilities, and "zero" is only a meaningful claim
 * if the way to request one exists. Adding the field in M3 instead would mean
 * every manifest written before then has no capability list, and the gate's
 * first act would be to decide what an absent list means — which is exactly the
 * ambiguity a default should never have to resolve.
 *
 * ## Why a closed set
 *
 * A capability is a *name the core knows how to enforce*. An open string would
 * let a manifest request `filesystem.everything` and be accepted by a validator
 * that has no idea what it means, and the request would sit in a config file
 * looking legitimate. `SEC-2` — a capability nobody can enforce is not a
 * capability.
 */

/**
 * The capabilities the platform intends to arbitrate.
 *
 * Deliberately small. Each entry is a promise that M3 will implement a gate for
 * it, so a name added here is work committed to rather than a placeholder.
 */
export const WIDGET_CAPABILITIES = [
  /** Read the machine's own sensors: CPU, memory, battery. */
  'system.metrics',
  /** Outbound network to a declared origin. Never unrestricted (`AC-OFF-2.1`). */
  'network.origin',
  /** Read and write the widget's own private state beyond the default quota. */
  'storage.extended',
  /** Read the clipboard. Writing is a separate, more dangerous grant. */
  'clipboard.read',
  /** Post a notification through the platform's own surface. */
  'notification.post',
] as const;

/** A capability a widget may declare. */
export type WidgetCapability = (typeof WIDGET_CAPABILITIES)[number];

/** Whether a string names a capability the platform knows. */
export function isWidgetCapability(value: string): value is WidgetCapability {
  return (WIDGET_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * The empty capability set.
 *
 * What every first-party widget in M0 declares, and what `AC-FRE-6.1` requires:
 * the default arrangement must run without asking the user for anything.
 */
export const NO_CAPABILITIES: readonly WidgetCapability[] = Object.freeze([]);
