/**
 * What a widget is called, and what one *instance* of it is called.
 *
 * ## Two identities, and the reason there are two
 *
 * A user can put three clocks on their desktop. They are the same widget and
 * three different things: they share a manifest, an icon, and a code path, and
 * they have their own positions, their own settings, and their own windows.
 *
 * | | {@link WidgetId} | {@link WidgetInstanceId} |
 * | --- | --- | --- |
 * | Names | The *kind* of widget | One placement of it |
 * | Declared by | The manifest | The runtime, on first placement |
 * | Unique across | The registry | The user's whole configuration |
 * | Example | `devdesk.clock` | `devdesk.clock#2` |
 *
 * ## The invariant
 *
 * **A widget instance's identity survives a restart.** It is what an arrangement
 * is stored against, so an identity derived from load order, registration order,
 * or an in-memory counter reintroduces `PS-3` — the arrangement comes back
 * attached to the wrong instance, or to none.
 *
 * That is why {@link widgetInstanceId} composes the widget id with an ordinal
 * the caller supplies and persists, rather than generating one. A random UUID
 * would also be stable, but it is unreadable in a config file and in a log, and
 * the ordinal is what a user means when they say "my second clock".
 */

import { type Brand, brand, err, ok, type Result } from '@devdesk/shared';

/** The identity of a *kind* of widget, declared by its manifest. */
export type WidgetId = Brand<string, 'WidgetId'>;

/** The identity of one placement of a widget. */
export type WidgetInstanceId = Brand<string, 'WidgetInstanceId'>;

/**
 * Reverse-DNS-ish: a publisher segment, a name segment, optionally more.
 *
 * Constrained rather than free-form because a widget id becomes a config key, a
 * log field, and eventually a directory name in a plugin bundle. Allowing
 * arbitrary text means discovering at packaging time that an id cannot be a
 * path, which is the wrong moment.
 */
const WIDGET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/** Why an identity was rejected. */
export type IdentityError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'malformed'; readonly expected: string }
  | { readonly kind: 'too-long'; readonly limit: number }
  | { readonly kind: 'bad-ordinal'; readonly ordinal: number };

/**
 * The longest an id may be.
 *
 * Not arbitrary: it has to fit a Tauri window label, a filesystem path segment,
 * and a log line without truncation, and the smallest of those is what this
 * respects.
 */
const MAX_ID_LENGTH = 96;

/**
 * Validates and brands a widget id.
 *
 * Requires at least one dot, so `clock` is rejected and `devdesk.clock` is
 * accepted. Unqualified names collide the moment a second author publishes a
 * clock, and the registry cannot tell which one an arrangement meant.
 */
export function widgetId(value: string): Result<WidgetId, IdentityError> {
  const trimmed = value.trim();

  if (trimmed.length === 0) return err({ kind: 'empty' });
  if (trimmed.length > MAX_ID_LENGTH) return err({ kind: 'too-long', limit: MAX_ID_LENGTH });
  if (!WIDGET_ID.test(trimmed)) {
    return err({
      kind: 'malformed',
      expected: 'lowercase dotted segments, e.g. devdesk.clock',
    });
  }

  return ok(brand<string, 'WidgetId'>(trimmed));
}

/**
 * Composes an instance identity from a widget id and a persisted ordinal.
 *
 * The ordinal is the caller's to allocate and to store. This function does not
 * generate one on purpose: a counter owned here would restart at zero on the
 * next launch and hand out an identity that already belongs to a placed widget.
 */
export function widgetInstanceId(
  widget: WidgetId,
  ordinal: number,
): Result<WidgetInstanceId, IdentityError> {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    return err({ kind: 'bad-ordinal', ordinal });
  }

  return ok(brand<string, 'WidgetInstanceId'>(`${widget}#${ordinal}`));
}

/**
 * Recovers an instance identity from stored text.
 *
 * The parse is strict. A stored identity that no longer parses is a corrupt
 * configuration, and reading it loosely would silently place a widget under an
 * identity nothing else refers to.
 */
export function parseWidgetInstanceId(
  value: string,
): Result<WidgetInstanceId, IdentityError> {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf('#');

  if (separator <= 0) {
    return err({ kind: 'malformed', expected: 'widget-id#ordinal, e.g. devdesk.clock#1' });
  }

  const widget = widgetId(trimmed.slice(0, separator));
  if (!widget.ok) return widget;

  const ordinal = Number(trimmed.slice(separator + 1));
  return widgetInstanceId(widget.value, ordinal);
}

/** The widget an instance is a placement of. */
export function widgetOf(instance: WidgetInstanceId): WidgetId {
  const separator = instance.lastIndexOf('#');
  return brand<string, 'WidgetId'>(instance.slice(0, separator));
}

/** Which placement of its widget this instance is. */
export function ordinalOf(instance: WidgetInstanceId): number {
  return Number(instance.slice(instance.lastIndexOf('#') + 1));
}
