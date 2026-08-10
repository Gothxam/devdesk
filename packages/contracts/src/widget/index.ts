/**
 * The widget contract: what a widget is, and what it declares about itself.
 *
 * These types live in `@devdesk/contracts` rather than in the runtime because
 * they are the schema a third-party manifest is validated against, and `DR-4`
 * makes the plugin SDK re-export them in M3. A contract type that lived in the
 * runtime would drag the runtime into the SDK's dependency graph.
 */

export {
  type WidgetId,
  type WidgetInstanceId,
  type IdentityError,
  widgetId,
  widgetInstanceId,
  parseWidgetInstanceId,
  widgetOf,
  ordinalOf,
} from './identity';

export {
  type WidgetVersion,
  type VersionError,
  parseVersion,
  formatVersion,
  compareVersions,
  satisfies,
} from './version';

export {
  type WidgetCapability,
  WIDGET_CAPABILITIES,
  NO_CAPABILITIES,
  isWidgetCapability,
} from './capability';

export {
  type SurfaceId,
  type MonitorId,
  type CoreIdentityError,
  surfaceId,
  monitorId,
} from './surface';

export {
  type WidgetManifest,
  type WidgetSize,
  type ManifestError,
  parseWidgetManifest,
  describeManifestError,
  describeManifest,
} from './manifest';
