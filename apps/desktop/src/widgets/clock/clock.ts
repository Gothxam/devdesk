/**
 * The clock widget.
 *
 * ## Why a clock is the first widget
 *
 * Not because clocks matter. Because it is the smallest thing that exercises
 * every part of the runtime at once: it has a manifest to validate, an identity
 * to persist, a lifecycle to walk, a theme to read, a surface to attach to, a
 * reason to update on its own, and a reason to stop updating when suspended.
 * A widget that only rendered static text would leave half of that untested.
 *
 * ## Time is injected
 *
 * `TS-6` requires tests to depend on no wall-clock time. A clock that read
 * `Date.now()` internally would be untestable except by waiting, so the source
 * is a constructor argument. The shell passes the real one; a test passes a
 * function it controls, and asserts the rendered output exactly.
 *
 * The same argument applies to the ticking: the widget does not own a timer.
 * It exposes {@link ClockInstance.tick} and the shell decides when to call it —
 * on an animation frame, on an interval, or never. `@devdesk/animation` owns RAF
 * (§6.2.2), and a widget starting its own `setInterval` would be the ad-hoc
 * animation that package exists to prevent.
 *
 * ## It reads the theme, it does not style itself
 *
 * The view carries token *values* read from the snapshot in the context. The
 * widget never emits CSS, never touches a custom property, and never decides
 * what a colour should be — it asks the resolved theme what the accent is and
 * puts the answer in its view model.
 */

import { tokenId, type ThemeSnapshot } from '@devdesk/theme-engine';
import type { WidgetContext, WidgetDefinition, WidgetInstance } from '@devdesk/widget-engine';
import { widgetId } from '@devdesk/contracts';

/** What the clock wants shown. A plain value; the shell turns it into pixels. */
export interface ClockView {
  /** `HH:MM`, in the machine's local time. */
  readonly time: string;
  /** The day, as a short human string. */
  readonly date: string;
  /** The resolved accent colour. Read from the theme, never chosen here. */
  readonly accent: string;
  /** The resolved foreground colour. */
  readonly foreground: string;
  /**
   * Whether the surface currently has a display.
   *
   * A clock with nowhere to be shown still knows the time; this lets the shell
   * decide what that should look like rather than the widget guessing.
   */
  readonly hasDisplay: boolean;
}

/** How the clock gets the time. */
export interface ClockOptions {
  /** Defaults to the system clock. Injected so tests need no wall-clock time. */
  readonly now?: () => Date;
}

/** A running clock, with the extra handle the shell needs to advance it. */
export interface ClockInstance extends WidgetInstance<ClockView> {
  /** Recomputes the time. The shell decides when; the widget owns no timer. */
  readonly tick: () => void;
}

const ACCENT = tokenId('color.accent');
const FOREGROUND = tokenId('color.ink');

/** Reads a token, falling back to something visible rather than to nothing. */
function read(theme: ThemeSnapshot, id: ReturnType<typeof tokenId>, fallback: string): string {
  return theme.tokens.get(id) ?? fallback;
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatTime(at: Date): string {
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

function formatDate(at: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[at.getDay()]} ${at.getDate()} ${months[at.getMonth()]}`;
}

/**
 * Builds the clock's definition.
 *
 * A factory rather than a constant because the time source is a parameter. The
 * definition it returns is what the host is `define`d with, and the host builds
 * one {@link ClockInstance} per attachment.
 */
export function createClockWidget(options: ClockOptions = {}): WidgetDefinition<ClockView> {
  const now = options.now ?? (() => new Date());
  const id = widgetId('devdesk.clock');
  if (!id.ok) throw new Error('the clock widget id must be valid');

  return {
    id: id.value,
    create(context: WidgetContext): ClockInstance {
      // Captured at creation and refreshed on tick, so two renders between
      // ticks agree. A render that read the clock itself would make `render`
      // impure, and the host reserves the right to call it more than once for
      // one change.
      let at = now();

      return {
        tick() {
          at = now();
        },

        render(current: WidgetContext): ClockView {
          return Object.freeze({
            time: formatTime(at),
            date: formatDate(at),
            accent: read(current.theme, ACCENT, '#7aa2ff'),
            foreground: read(current.theme, FOREGROUND, '#f2f4f8'),
            hasDisplay: current.monitorId !== undefined,
          });
        },

        onEvent(event) {
          // Resuming after a suspension: the time moved on while it was not
          // updating, so catch up before the first render back. Every other
          // event changes the context, and the host re-renders for those
          // anyway.
          if (event.kind === 'resumed') at = now();
        },
      };
    },
  };
}
