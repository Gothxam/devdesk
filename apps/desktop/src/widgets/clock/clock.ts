/**
 * The clock widget — moved.
 *
 * The implementation now lives with the rest of the first-party set in
 * `../../desktop/widgets/`. This file remains because three modules outside
 * this stage's ownership import from it (`shell.tsx`, `desktop-root.tsx`,
 * `components/surface-card.tsx`), and moving a file those depend on would
 * break them.
 *
 * `ClockView` is re-exported as the shared view envelope every first-party
 * widget produces — see `desktop/widgets/view.ts` for why there is one shape
 * rather than five, and what `time` and `date` mean for a widget that is not a
 * clock. Renaming it is a coordinated change with the UI side.
 */

export { CLOCK_WIDGET, CLOCK_CADENCE_MS, CLOCK_MANIFEST } from '../../desktop/widgets/clock';
export type { DesktopWidgetView as ClockView } from '../../desktop/widgets/view';
