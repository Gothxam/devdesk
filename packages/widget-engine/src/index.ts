/**
 * `@devdesk/widget-engine` — public surface.
 *
 * This file is the only importable entry point (DR-5). Anything not exported
 * here is internal, and `dependency-cruiser` enforces it.
 *
 * ## What this package is
 *
 * The widget runtime: what widgets exist, how one progresses from registered to
 * running, and how it reaches a surface. `WR-1` assigns surface lifecycle here.
 *
 * ## What it never touches
 *
 * The window subsystem and the platform. A widget attaches to a *surface*, and
 * the surface is created by the Rust core. Nothing in this package holds a
 * window, a monitor handle, or a Tauri import — the boundary is a surface port,
 * which the host application implements against the generated contract.
 *
 * It also never renders. Widgets produce view models; the shell turns those into
 * pixels. That is what lets widget behaviour be tested without a DOM.
 */

export {
  type WidgetPhase,
  type WidgetLifecycleEvent,
  type WidgetLifecycle,
  type LifecycleError,
  WIDGET_PHASES,
  WIDGET_LIFECYCLE_EVENTS,
  createLifecycle,
  lifecycleAt,
  nextPhase,
  accepts,
  hasSurface,
  isUpdating,
  describeLifecycleError,
} from './lifecycle';

export {
  type WidgetRegistry,
  type RegistrationError,
  type UnregistrationError,
  type BulkRegistration,
  createWidgetRegistry,
  registerAll,
  validateManifest,
  describeRegistrationError,
} from './registry';

export {
  type WidgetContext,
  type WidgetContextInit,
  createWidgetContext,
  withUpdates,
} from './context';

export {
  type WidgetEvent,
  type WidgetEventChannel,
  type WidgetEventListener,
  type WidgetEventPublisher,
  type DeliveryFailure,
  type Unsubscribe,
  createEventChannel,
} from './events';

export {
  type WidgetDefinition,
  type WidgetUpdate,
  type WidgetUpdateReason,
  type UpdateCadence,
  WIDGET_UPDATE_REASONS,
  NO_CADENCE,
  everyMs,
  hasReason,
  createUpdate,
} from './definition';

export {
  type SurfacePort,
  type SurfacePortError,
  type BindingError,
  WidgetSurfaceBinder,
  describeBindingError,
} from './surface';

export {
  type SurfacePlacement,
  type HostError,
  type InstanceSnapshot,
  type FlushOutcome,
  WidgetHost,
  describeHostError,
} from './host';

export {
  type TimerService,
  type ManualTimer,
  type CancelTimer,
  createManualTimer,
} from './timer';

export {
  type SchedulerOptions,
  type FlushReport,
  type SchedulerMetrics,
  WidgetScheduler,
  cadenceOf,
} from './scheduler';
