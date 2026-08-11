/**
 * The composed desktop, assembled.
 *
 * ```text
 *  ThemeSnapshot ──┐
 *  ShellDisplay ───┼─▶ DesktopController ─▶ CompositionScene ─▶ Compositor ─▶ onFrame
 *  TimerService ───┘         │                                                (React paints)
 *                            └─▶ WidgetHost + WidgetScheduler ─▶ onViews
 * ```
 *
 * `WidgetHost` is the source of truth for every surface's content. Nothing here
 * renders, and nothing here invents a value: each of the five cards on the
 * desktop is a widget instance the host is running, and every field it shows was
 * computed from a timestamp the runtime supplied or a fact the runtime observed.
 *
 * None of this touches the DOM. The frame source, the timer, and the callbacks
 * are injected, so the whole pipeline — placement, theme switch, ticking
 * widgets, hit testing — runs in Node and is benchmarkable without a browser.
 */

import {
  widgetId,
  widgetInstanceId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import type { ThemeSnapshot } from '@devdesk/theme-engine';
import {
  appearanceFromTheme,
  Compositor,
  createCompositionSurface,
  createScene,
  createWidgetRegistry,
  describeRegistrationError,
  hitTest,
  registerAll,
  WidgetHost,
  WidgetScheduler,
  WidgetSurfaceBinder,
  type CompositionFrame,
  type CompositionScene,
  type CompositionSurface,
  type FrameSource,
  type Point,
  type SurfaceAppearance,
  type TimerService,
} from '@devdesk/widget-engine';

import {
  DESKTOP_MARGIN,
  findOverlaps,
  resolveArrangement,
  type Column,
  type ResolvedPlacement,
} from './arrangement';
import { createComposedPort, type ComposedSurfacePort } from './composed-port';
import type { ShellDisplay } from './displays';
import { createActivityWidget, ACTIVITY_MANIFEST } from './widgets/activity';
import { CALENDAR_MANIFEST, CALENDAR_WIDGET } from './widgets/calendar';
import { CLOCK_MANIFEST, CLOCK_WIDGET } from './widgets/clock';
import { EMPTY_ACTIVITY, EMPTY_SYSTEM, type ActivitySnapshot, type SystemSnapshot } from './widgets/feeds';
import { SESSION_MANIFEST, SESSION_WIDGET } from './widgets/session';
import type { DesktopWidgetDefinition, DesktopWidgetState } from './widgets/state';
import { createSystemWidget, SYSTEM_MANIFEST } from './widgets/system';
import type { ActivityEntry, DesktopWidgetView, SystemFact } from './widgets/view';

/**
 * The arrangement: two columns down the screen edges.
 *
 * Right, top to bottom: clock, calendar, session — the things glanced at.
 * Left, top to bottom: session log, system — the things read when something
 * looks wrong.
 *
 * Columns rather than a scatter, because desktop widgets are glanced at rather
 * than browsed, and holding them to the edges leaves the middle of the screen —
 * where the user's actual windows go — clear. Heights come from each manifest's
 * `preferredSize`, so a widget that needs more room says so in the one place an
 * author would look.
 *
 * Every surface is on the `desktop` band, below ordinary windows. Nothing here
 * belongs above them: a clock floating over the user's editor is a nuisance, and
 * `overlay` is for things that are genuinely transient.
 */
const COLUMN_WIDTH = 300;

const DESKTOP_COLUMNS: readonly Column[] = Object.freeze([
  {
    anchor: 'top-right',
    width: COLUMN_WIDTH,
    entries: Object.freeze([
      { widgetId: CLOCK_MANIFEST.id, height: CLOCK_MANIFEST.preferredSize.height },
      { widgetId: CALENDAR_MANIFEST.id, height: CALENDAR_MANIFEST.preferredSize.height },
      { widgetId: SESSION_MANIFEST.id, height: SESSION_MANIFEST.preferredSize.height },
    ]),
  },
  {
    anchor: 'top-left',
    width: COLUMN_WIDTH,
    entries: Object.freeze([
      { widgetId: ACTIVITY_MANIFEST.id, height: ACTIVITY_MANIFEST.preferredSize.height },
      { widgetId: SYSTEM_MANIFEST.id, height: SYSTEM_MANIFEST.preferredSize.height },
    ]),
  },
]);

/** How many log entries the card keeps. Older ones are counted, not kept. */
const ACTIVITY_LIMIT = 24;

/** What the controller reports outward. */
export interface DesktopCallbacks {
  readonly onFrame: (frame: CompositionFrame) => void;
  readonly onViews: (views: ReadonlyMap<WidgetInstanceId, DesktopWidgetView>) => void;
}

export interface DesktopControllerOptions {
  readonly theme: ThemeSnapshot;
  readonly display: ShellDisplay;
  readonly timer: TimerService;
  readonly frameSource: FrameSource;
  readonly callbacks: DesktopCallbacks;
  readonly reducedTransparency?: boolean;
}

/** Pipeline counters. Every one is observed; none is a constant. */
export interface DesktopMetrics {
  readonly frames: number;
  readonly updates: number;
  readonly coalescedReasons: number;
  readonly wakeups: number;
}

export class DesktopController {
  readonly #host: WidgetHost<DesktopWidgetState, DesktopWidgetView>;
  readonly #scheduler: WidgetScheduler<DesktopWidgetState, DesktopWidgetView>;
  readonly #binder: WidgetSurfaceBinder<DesktopWidgetState, DesktopWidgetView>;
  readonly #port: ComposedSurfacePort;
  readonly #compositor: Compositor;
  readonly #callbacks: DesktopCallbacks;
  readonly #timer: TimerService;
  readonly #views = new Map<WidgetInstanceId, DesktopWidgetView>();
  readonly #placed: { readonly instance: WidgetInstanceId; readonly widgetId: string }[] = [];

  #display: ShellDisplay;
  #theme: ThemeSnapshot;
  #reducedTransparency: boolean;

  /** The activity feed's current frozen value. Swapped, never mutated. */
  #activity: ActivitySnapshot = EMPTY_ACTIVITY;
  /** Every event this session recorded, including ones past the display limit. */
  #activityTotal = 0;
  #system: SystemSnapshot = EMPTY_SYSTEM;

  constructor(options: DesktopControllerOptions) {
    this.#display = options.display;
    this.#callbacks = options.callbacks;
    this.#theme = options.theme;
    this.#timer = options.timer;
    this.#reducedTransparency = options.reducedTransparency ?? false;

    // Every first-party manifest goes through the validation a third-party
    // bundle will (S-10, DD-008). A rejection is a mistake in our own data, so
    // it fails loudly rather than shipping a desktop with a card missing.
    const registered = registerAll(createWidgetRegistry(), [
      CLOCK_MANIFEST,
      CALENDAR_MANIFEST,
      SESSION_MANIFEST,
      ACTIVITY_MANIFEST,
      SYSTEM_MANIFEST,
    ]);
    if (registered.rejected.length > 0) {
      const reasons = registered.rejected
        .map((entry) => describeRegistrationError(entry.error))
        .join('; ');
      throw new Error(`a first-party manifest is invalid: ${reasons}`);
    }

    this.#host = new WidgetHost<DesktopWidgetState, DesktopWidgetView>(
      registered.registry,
      options.theme,
    );

    const definitions: readonly DesktopWidgetDefinition[] = [
      CLOCK_WIDGET,
      CALENDAR_WIDGET,
      SESSION_WIDGET,
      // The two runtime-observing widgets read frozen snapshots this controller
      // swaps. See `widgets/feeds.ts` for why that is not a hole in purity.
      createActivityWidget(() => this.#activity),
      createSystemWidget(() => this.#system),
    ];

    for (const definition of definitions) {
      const defined = this.#host.define(definition);
      if (!defined.ok) throw new Error(`the definition for ${definition.id} was refused`);
    }

    this.#scheduler = new WidgetScheduler(this.#host, options.timer, {
      onFlush: (report) => {
        // Both lists, not just `changed`. `changed` means the widget's *state*
        // moved; a view is derived from state **and context**, so a theme change
        // produces an unchanged state and a different view. Refreshing only the
        // changed ones would leave every card in the old colours until its next
        // tick.
        const ran = [...report.changed, ...report.unchanged];
        if (ran.length === 0) return;

        for (const instance of ran) this.refreshView(instance);
        this.#callbacks.onViews(new Map(this.#views));
      },
    });

    this.#port = createComposedPort(options.display.monitorId);
    this.#binder = new WidgetSurfaceBinder(this.#host, this.#port);
    this.#compositor = new Compositor(options.frameSource, (frame) => {
      this.#callbacks.onFrame(frame);
    });

    this.refreshSystemFacts();
  }

  get display(): ShellDisplay {
    return this.#display;
  }

  /** The scene as of the last update. Hit tests run against this. */
  get scene(): CompositionScene {
    return this.#compositor.scene;
  }

  get instances(): readonly WidgetInstanceId[] {
    return this.#placed.map((entry) => entry.instance);
  }

  /**
   * Places every first-party widget and presents the first scene.
   *
   * Surfaces enter the scene **invisible**. The reveal happens in
   * {@link DesktopController.markPainted}, after the shell has actually painted,
   * so the composed desktop keeps the no-flash ordering the real window path has
   * (`AC-FRE-1.1`).
   */
  async place(at: number): Promise<void> {
    for (const column of DESKTOP_COLUMNS) {
      for (const entry of column.entries) {
        const widget = widgetId(entry.widgetId);
        if (!widget.ok) throw new Error(`the widget id ${entry.widgetId} must be valid`);

        // Ordinal 1: the first placement of each kind. The identity persists, so
        // a stored arrangement would name exactly this.
        const instance = widgetInstanceId(widget.value, 1);
        if (!instance.ok) throw new Error('a first placement must be valid');

        const placed = await this.#binder.place(instance.value, at);
        if (!placed.ok) throw new Error(`placing ${instance.value} failed`);

        // Settle the attach update so the first render has a view, then hand the
        // cadence to the scheduler.
        this.#host.flush(instance.value, at);
        this.refreshView(instance.value);
        this.#scheduler.register(instance.value);
        this.#placed.push({ instance: instance.value, widgetId: entry.widgetId });

        this.record('widget', `placed ${entry.widgetId}`, at);
      }
    }

    this.#scheduler.start();
    this.refreshSystemFacts();
    // Everything is placed now, so the log and the system card can report the
    // full set rather than however much of it existed when they were built.
    this.settle(at);
    this.#callbacks.onViews(new Map(this.#views));
    this.#compositor.update(this.buildScene({ visible: false }));
    this.#compositor.flush();
  }

  /** The shell painted: reveal every surface. */
  markPainted(): void {
    for (const entry of this.#placed) {
      void this.#binder.reportPainted(entry.instance);
      this.#scheduler.setVisibility(entry.instance, 'visible');
    }

    this.record('frame', 'first frame presented', this.#timer.now());
    this.refreshSystemFacts();
    this.settle(this.#timer.now());
    this.#compositor.update(this.buildScene({ visible: true }));
  }

  /**
   * Adopts a new resolved theme.
   *
   * Order is the pipeline's: host first — contexts rebuilt, widgets marked
   * dirty — then the scheduler told in one batch (`requestAll`, not a request
   * per instance, which re-arms the wake-up N times), then the scene rebuilt so
   * glass follows the theme, then the compositor.
   */
  applyTheme(theme: ThemeSnapshot, reducedTransparency?: boolean): void {
    this.#theme = theme;
    if (reducedTransparency !== undefined) this.#reducedTransparency = reducedTransparency;

    const affected = this.#host.applyTheme(theme);
    this.#scheduler.requestAll(affected, 'theme-changed');

    this.record('theme', `theme ${theme.metadata.themeName} · ${theme.metadata.mode}`, this.#timer.now());
    this.settle(this.#timer.now());
    this.#compositor.update(this.buildScene({ visible: true }));
  }

  /**
   * Adopts a new display and re-resolves the arrangement against it.
   *
   * The surfaces do not move themselves — the arrangement is recomputed from
   * the new work area and the scene rebuilt, which is what makes the desktop
   * correct after a resolution change rather than merely still running.
   */
  applyDisplay(display: ShellDisplay): void {
    if (display.monitorId === this.#display.monitorId &&
        display.workArea.width === this.#display.workArea.width &&
        display.workArea.height === this.#display.workArea.height) {
      return;
    }

    this.#display = display;
    for (const entry of this.#placed) {
      this.#host.moveToMonitor(entry.instance, display.monitorId);
    }

    this.record('display', `display ${display.name}`, this.#timer.now());
    this.refreshSystemFacts();
    this.settle(this.#timer.now());
    this.#compositor.update(this.buildScene({ visible: true }));
  }

  /** The surface a click at this point lands on, if any. */
  hitAt(point: Point): CompositionSurface | undefined {
    return hitTest(this.#compositor.scene, point);
  }

  views(): ReadonlyMap<WidgetInstanceId, DesktopWidgetView> {
    return new Map(this.#views);
  }

  /** Observed counters. Nothing here is a placeholder. */
  metrics(): DesktopMetrics {
    const scheduler = this.#scheduler.metrics;
    const compositor = this.#compositor.metrics;

    return Object.freeze({
      frames: compositor.frames,
      updates: scheduler.updates,
      coalescedReasons: scheduler.reasons,
      wakeups: scheduler.wakeups,
    });
  }

  /** Presents anything owed immediately. The benchmark's escape hatch. */
  flushFrame(): CompositionFrame | undefined {
    return this.#compositor.flush();
  }

  stop(): void {
    this.#scheduler.stop();
    this.#host.destroyAll();
  }

  // --------------------------------------------------------------- internal --

  /**
   * Records something that actually happened, and asks the log to update.
   *
   * The snapshot is rebuilt frozen and the reference swapped, so the widget's
   * identity check is a sound test for "nothing new". The total counts every
   * event, including ones past the display limit — a log that silently dropped
   * its tail and reported the truncated count would understate what happened.
   */
  private record(channel: ActivityEntry['channel'], message: string, at: number): void {
    this.#activityTotal += 1;

    const entry: ActivityEntry = Object.freeze({ at, channel, message });
    const entries = Object.freeze([entry, ...this.#activity.entries].slice(0, ACTIVITY_LIMIT));

    this.#activity = Object.freeze({ entries, total: this.#activityTotal });

    const log = this.#placed.find((placed) => placed.widgetId === ACTIVITY_MANIFEST.id);
    if (log) this.#scheduler.request(log.instance, 'requested');
  }

  /** Rebuilds the system snapshot from what the runtime can observe. */
  private refreshSystemFacts(): void {
    const area = this.#display.workArea;
    const metrics = this.metrics();

    const facts: readonly SystemFact[] = Object.freeze([
      { label: 'Display', value: this.#display.name },
      {
        label: 'Work area',
        value: `${Math.round(area.width)} × ${Math.round(area.height)}`,
      },
      { label: 'Scale', value: `${this.#display.scaleFactor.toFixed(2)}×` },
      { label: 'Surfaces', value: String(this.#placed.length) },
      { label: 'Frames', value: String(metrics.frames) },
      { label: 'Scheduler wake-ups', value: String(metrics.wakeups) },
      { label: 'Widget updates', value: String(metrics.updates) },
    ]);

    this.#system = Object.freeze({ facts });

    const system = this.#placed.find((placed) => placed.widgetId === SYSTEM_MANIFEST.id);
    if (system) this.#scheduler.request(system.instance, 'requested');
  }

  /**
   * Runs the widgets that owe work and republishes their views, now.
   *
   * The scheduler would get to them within a throttle window, which is right
   * for a cadence tick and wrong for a theme switch: `AC-THM-3.1` makes theme
   * application atomic, and a card still showing the old accent a frame later
   * is exactly the split the rule forbids. The same argument covers a display
   * change and a log entry — each is a discrete thing the user did or observed,
   * not periodic work, so it settles immediately.
   *
   * Cadence stays the scheduler's. This only drains what is already owed.
   */
  private settle(at: number): void {
    let changed = false;

    for (const entry of this.#placed) {
      if (!this.#host.isDirty(entry.instance)) continue;

      const flushed = this.#host.flush(entry.instance, at);
      if (!flushed.ok) continue;

      this.refreshView(entry.instance);
      changed = true;
    }

    if (changed) this.#callbacks.onViews(new Map(this.#views));
  }

  private refreshView(instance: WidgetInstanceId): void {
    const view = this.#host.render(instance);
    if (view.ok) this.#views.set(instance, view.value);
  }

  private buildScene(options: { readonly visible: boolean }): CompositionScene {
    const glass = appearanceFromTheme(this.#theme, {
      reducedTransparency: this.#reducedTransparency,
    });

    const resolved = resolveArrangement(this.#display, DESKTOP_COLUMNS);
    const byWidget = new Map<string, ResolvedPlacement>();
    for (const placement of resolved) byWidget.set(placement.widgetId, placement);

    const surfaces = this.#placed.map((entry, index) => {
      const placement = byWidget.get(entry.widgetId);
      if (!placement) throw new Error(`no placement resolved for ${entry.widgetId}`);

      return createCompositionSurface({
        surfaceId: this.surfaceOf(entry.instance),
        monitorId: this.#display.monitorId,
        rect: placement.rect,
        // Every first-party surface sits on the desktop band, below ordinary
        // windows. The ordinal only orders within the band, and it is stable
        // because it comes from placement order rather than from a map walk.
        layer: 'desktop',
        ordinal: index + 1,
        pointerMode: 'interactive',
        isVisible: options.visible,
        // Every surface takes the theme's glass. A desktop where some widgets
        // are glass and others are not looks like two designs sharing a screen.
        appearance: glass as Partial<SurfaceAppearance>,
      });
    });

    return createScene(surfaces);
  }

  private surfaceOf(instance: WidgetInstanceId) {
    const context = this.#host.contextOf(instance);
    if (!context) throw new Error(`instance ${instance} has no surface`);
    return context.surfaceId;
  }
}

/** Exposed so a test can assert the shipped arrangement never overlaps. */
export const DESKTOP_ARRANGEMENT_COLUMNS = DESKTOP_COLUMNS;
export { DESKTOP_MARGIN, findOverlaps };
