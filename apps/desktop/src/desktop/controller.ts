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
 * Everything the checkpoint wires lives here, and none of it touches the DOM:
 * the frame source, the timer, and the two callbacks are injected, so the
 * entire pipeline — placement, theme switch, ticking clocks, hit testing — is
 * testable in Node and benchmarkable without a browser.
 *
 * ## Positions are constants, loudly
 *
 * The three placements below are **hardcoded demo positions**, not layout.
 * Stage 5 owns where surfaces go; this file owns proving that whatever decides
 * positions can be composed, themed, and hit-tested. The constants exist to be
 * deleted.
 */

import {
  widgetId,
  widgetInstanceId,
  type MonitorId,
  type WidgetInstanceId,
} from '@devdesk/contracts';
import type { ThemeSnapshot } from '@devdesk/theme-engine';
import {
  appearanceFromTheme,
  Compositor,
  createWidgetRegistry,
  hitTest,
  rect,
  WidgetHost,
  WidgetScheduler,
  WidgetSurfaceBinder,
  type CompositionFrame,
  type CompositionLayer,
  type CompositionSurface,
  type FrameSource,
  type Point,
  type PointerMode,
  type Rect,
  type SurfaceAppearance,
  type TimerService,
  createCompositionSurface,
  createScene,
  type CompositionScene,
} from '@devdesk/widget-engine';

import { CLOCK_WIDGET, type ClockState, type ClockView } from '../widgets/clock/clock';
import { CLOCK_MANIFEST } from '../widgets/clock/manifest';
import { createComposedPort, type ComposedSurfacePort } from './composed-port';
import type { ShellDisplay } from './displays';

/** One demo placement. Deleted when the layout engine exists. */
interface DemoPlacement {
  readonly ordinal: number;
  readonly rect: Rect;
  readonly layer: CompositionLayer;
  /** Whether this surface takes the theme's glass appearance. */
  readonly glassy: boolean;
  readonly pointerMode: PointerMode;
}

/**
 * Three clocks, arranged to demonstrate the model rather than to be useful:
 * they overlap so blur has something behind it, they span two bands so paint
 * order is visible, and the overlay is click-through so hit testing shows a
 * click passing through a surface.
 */
const DEMO_PLACEMENTS: readonly DemoPlacement[] = Object.freeze([
  { ordinal: 1, rect: rect(48, 48, 260, 150), layer: 'desktop', glassy: false, pointerMode: 'interactive' },
  { ordinal: 2, rect: rect(220, 130, 260, 150), layer: 'normal', glassy: true, pointerMode: 'interactive' },
  { ordinal: 3, rect: rect(120, 96, 300, 96), layer: 'overlay', glassy: true, pointerMode: 'click-through' },
]);

/** What the controller reports outward. */
export interface DesktopCallbacks {
  /** A frame was presented. React paints from this. */
  readonly onFrame: (frame: CompositionFrame) => void;
  /** Widget views changed. React re-renders surface content from this. */
  readonly onViews: (views: ReadonlyMap<WidgetInstanceId, ClockView>) => void;
}

export interface DesktopControllerOptions {
  readonly theme: ThemeSnapshot;
  readonly display: ShellDisplay;
  readonly timer: TimerService;
  readonly frameSource: FrameSource;
  readonly callbacks: DesktopCallbacks;
  readonly reducedTransparency?: boolean;
}

/** Everything the control strip wants to show. */
export interface DesktopMetrics {
  readonly frames: number;
  readonly updates: number;
  readonly coalescedReasons: number;
  readonly wakeups: number;
}

export class DesktopController {
  readonly #host: WidgetHost<ClockState, ClockView>;
  readonly #scheduler: WidgetScheduler<ClockState, ClockView>;
  readonly #binder: WidgetSurfaceBinder<ClockState, ClockView>;
  readonly #port: ComposedSurfacePort;
  readonly #compositor: Compositor;
  readonly #callbacks: DesktopCallbacks;
  readonly #display: ShellDisplay;
  readonly #views = new Map<WidgetInstanceId, ClockView>();
  readonly #instances: WidgetInstanceId[] = [];
  #reducedTransparency: boolean;
  #theme: ThemeSnapshot;

  constructor(options: DesktopControllerOptions) {
    this.#display = options.display;
    this.#callbacks = options.callbacks;
    this.#theme = options.theme;
    this.#reducedTransparency = options.reducedTransparency ?? false;

    const registered = createWidgetRegistry().register(CLOCK_MANIFEST);
    if (!registered.ok) throw new Error('the clock manifest must validate');

    this.#host = new WidgetHost<ClockState, ClockView>(registered.value, options.theme);
    const defined = this.#host.define(CLOCK_WIDGET);
    if (!defined.ok) throw new Error('the clock definition must be accepted');

    this.#scheduler = new WidgetScheduler(this.#host, options.timer, {
      onFlush: (report) => {
        // Both lists, not just `changed`. `changed` means the widget's *state*
        // moved; a view is derived from state **and context**, so a theme
        // change produces an unchanged state and a different view. Refreshing
        // only the changed ones leaves the clocks in the old colours until
        // their next tick — which is exactly the bug this caught.
        const ran = [...report.changed, ...report.unchanged];
        if (ran.length === 0) return;

        for (const instance of ran) this.refreshView(instance);
        this.#callbacks.onViews(new Map(this.#views));
      },
    });

    this.#port = createComposedPort(options.display.monitorId);
    this.#binder = new WidgetSurfaceBinder(this.#host, this.#port);

    this.#compositor = new Compositor(options.frameSource, (frame) =>
      this.#callbacks.onFrame(frame),
    );
  }

  /** The display the desktop is composed on. */
  get display(): ShellDisplay {
    return this.#display;
  }

  /** The scene as of the last update. Hit tests run against this. */
  get scene(): CompositionScene {
    return this.#compositor.scene;
  }

  /** The instances placed, in placement order. */
  get instances(): readonly WidgetInstanceId[] {
    return this.#instances;
  }

  /**
   * Places the demo clocks and presents the first scene.
   *
   * Surfaces enter the scene **invisible**. The reveal — scene visibility plus
   * scheduler visibility — happens in {@link DesktopController.markPainted},
   * after the shell has actually painted, so the composed desktop keeps the
   * same no-flash ordering the real window path has.
   */
  async place(at: number): Promise<void> {
    const widget = widgetId('devdesk.clock');
    if (!widget.ok) throw new Error('the clock id must be valid');

    for (const placement of DEMO_PLACEMENTS) {
      const instance = widgetInstanceId(widget.value, placement.ordinal);
      if (!instance.ok) throw new Error('a demo ordinal must be valid');

      const placed = await this.#binder.place(instance.value, at);
      if (!placed.ok) throw new Error(`placing ${instance.value} failed`);

      // Settle the attach update now so the first render has a view, then hand
      // the cadence to the scheduler.
      this.#host.flush(instance.value, at);
      this.refreshView(instance.value);
      this.#scheduler.register(instance.value);
      this.#instances.push(instance.value);
    }

    this.#scheduler.start();
    this.#callbacks.onViews(new Map(this.#views));
    this.#compositor.update(this.buildScene({ visible: false }));
    this.#compositor.flush();
  }

  /**
   * The shell painted: reveal every surface and start counting them as seen.
   */
  markPainted(): void {
    for (const instance of this.#instances) {
      // The composed port records the paint; the real port would reveal an OS
      // window here. Failures are impossible for the composed port once placed.
      void this.#binder.reportPainted(instance);
      this.#scheduler.setVisibility(instance, 'visible');
    }

    this.#compositor.update(this.buildScene({ visible: true }));
  }

  /**
   * Adopts a new resolved theme.
   *
   * Order matters and is the pipeline's: host first (contexts rebuilt, widgets
   * marked dirty), scheduler told (so the dirty work is scheduled — the C40
   * finding, `requestAll` rather than a re-arm per instance), then the scene
   * rebuilt so glass follows the theme, then the compositor.
   */
  applyTheme(theme: ThemeSnapshot, reducedTransparency?: boolean): void {
    this.#theme = theme;
    if (reducedTransparency !== undefined) this.#reducedTransparency = reducedTransparency;

    const affected = this.#host.applyTheme(theme);
    this.#scheduler.requestAll(affected, 'theme-changed');

    this.#compositor.update(this.buildScene({ visible: true }));
  }

  /** The surface a click at this point lands on, if any. */
  hitAt(point: Point): CompositionSurface | undefined {
    return hitTest(this.#compositor.scene, point);
  }

  /** The current widget views, keyed by instance. */
  views(): ReadonlyMap<WidgetInstanceId, ClockView> {
    return new Map(this.#views);
  }

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

  /** Stops the scheduler and tears the widgets down. */
  stop(): void {
    this.#scheduler.stop();
    this.#host.destroyAll();
  }

  private refreshView(instance: WidgetInstanceId): void {
    const view = this.#host.render(instance);
    if (view.ok) this.#views.set(instance, view.value);
  }

  private buildScene(options: { readonly visible: boolean }): CompositionScene {
    const glass = appearanceFromTheme(this.#theme, {
      reducedTransparency: this.#reducedTransparency,
    });

    const surfaces = this.#instances.map((instance, index) => {
      const placement = DEMO_PLACEMENTS[index];
      if (!placement) throw new Error('placements and instances must agree');

      const appearance: Partial<SurfaceAppearance> = placement.glassy ? glass : {};

      return createCompositionSurface({
        surfaceId: this.surfaceOf(instance),
        monitorId: this.#display.monitorId,
        rect: placement.rect,
        layer: placement.layer,
        ordinal: placement.ordinal,
        pointerMode: placement.pointerMode,
        isVisible: options.visible,
        appearance,
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

/** Re-exported so the React layer imports one module. */
export { type CompositionFrame } from '@devdesk/widget-engine';
