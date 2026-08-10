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
 * window, a monitor handle, or a Tauri import — the boundary is a
 * `SurfacePort`, which the host application implements against the generated
 * contract.
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
