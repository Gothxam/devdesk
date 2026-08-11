/**
 * The view envelope every first-party widget produces.
 *
 * ## Why one shape rather than five
 *
 * The renderer (`components/surface-card.tsx`, owned by the UI side) reads
 * `accent`, `time`, `date`, `foreground`, and `hasDisplay` from **every**
 * surface's view. That is the contract as it stands, so every widget fills it,
 * and each one decides what its two lines say.
 *
 * The field names come from the clock, which was the first widget. They mean
 * *primary line* and *secondary line* for everything else — a calendar's
 * `time` is its month, the log's is its newest entry. Renaming them is a
 * coordinated change with the UI side rather than something this file can do
 * alone, so they are documented rather than renamed.
 *
 * Every widget also carries a `kind` and its own richer payload alongside. A
 * renderer that wants a calendar grid rather than two lines of text switches on
 * `kind` and reads `calendar`; nothing has to change on this side for it to do
 * so. The envelope is the floor, not the ceiling.
 *
 * ## Every field is runtime state
 *
 * There is no placeholder text and no sample data anywhere below. `primary` and
 * `secondary` are computed from the widget's state, which the runtime advanced
 * from a timestamp it supplied. A widget with nothing to say renders what is
 * true — an empty log says the log is empty.
 */

import type { ThemeSnapshot } from '@devdesk/theme-engine';
import { tokenId } from '@devdesk/theme-engine';
import type { WidgetContext } from '@devdesk/widget-engine';

/** Which first-party widget produced a view. */
export type DesktopViewKind = 'clock' | 'calendar' | 'session' | 'activity' | 'system';

/** One cell of the calendar grid. */
export interface CalendarCell {
  readonly day: number;
  readonly isToday: boolean;
  /** False for the leading and trailing days that pad the grid to six rows. */
  readonly isCurrentMonth: boolean;
  readonly isWeekend: boolean;
}

/** The calendar's own payload. */
export interface CalendarPayload {
  readonly monthLabel: string;
  readonly weekdays: readonly string[];
  /** Always six rows of seven, so the grid never changes height. */
  readonly weeks: readonly (readonly CalendarCell[])[];
}

/** One thing that actually happened, in this session. */
export interface ActivityEntry {
  /** When, in epoch milliseconds, from the runtime clock. */
  readonly at: number;
  /** `widget`, `theme`, `display`, `frame` — what the event was about. */
  readonly channel: 'widget' | 'theme' | 'display' | 'frame';
  readonly message: string;
}

/** The activity log's own payload. */
export interface ActivityPayload {
  /** Newest first. Bounded — see the widget. */
  readonly entries: readonly ActivityEntry[];
  /** How many events this session has produced in total, including dropped. */
  readonly total: number;
}

/** One line of the system readout. */
export interface SystemFact {
  readonly label: string;
  readonly value: string;
}

/** The system widget's own payload. */
export interface SystemPayload {
  readonly facts: readonly SystemFact[];
}

/** The session widget's own payload. */
export interface SessionPayload {
  readonly uptimeSeconds: number;
  readonly startedLabel: string;
}

/**
 * What every first-party widget renders to.
 *
 * The optional payloads are present exactly on the widget they belong to. They
 * are optional rather than a discriminated union because the renderer's current
 * prop type is a single view shape; `kind` still narrows correctly for a
 * consumer that wants to switch on it.
 */
export interface DesktopWidgetView {
  readonly kind: DesktopViewKind;
  /** What the card calls itself. */
  readonly title: string;
  /** The large line — the clock's time, the calendar's month. Real, always. */
  readonly time: string;
  /** The small line beneath it. Real, always. */
  readonly date: string;
  /** Resolved from the theme, never chosen by the widget. */
  readonly accent: string;
  readonly foreground: string;
  /** False when the surface has no display — a real state, not an error. */
  readonly hasDisplay: boolean;

  readonly calendar?: CalendarPayload;
  readonly activity?: ActivityPayload;
  readonly system?: SystemPayload;
  readonly session?: SessionPayload;
}

const ACCENT = tokenId('color.accent');
const FOREGROUND = tokenId('color.ink');

/** Reads a token, falling back to something visible rather than to nothing. */
function readToken(theme: ThemeSnapshot, id: ReturnType<typeof tokenId>, fallback: string): string {
  return theme.tokens.get(id) ?? fallback;
}

/**
 * Fills the parts of the envelope every widget answers the same way.
 *
 * Colours come from the resolved snapshot in the context — the widget asks the
 * theme what the accent is rather than deciding, so a theme switch changes
 * every card without a widget knowing it happened.
 */
export function envelope(
  context: WidgetContext,
  parts: {
    readonly kind: DesktopViewKind;
    readonly title: string;
    readonly time: string;
    readonly date: string;
  },
): DesktopWidgetView {
  return Object.freeze({
    kind: parts.kind,
    title: parts.title,
    time: parts.time,
    date: parts.date,
    accent: readToken(context.theme, ACCENT, '#7aa2ff'),
    foreground: readToken(context.theme, FOREGROUND, '#f2f4f8'),
    hasDisplay: context.monitorId !== undefined,
  });
}
