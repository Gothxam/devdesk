/**
 * The DevDesk shell — Trust Zone 1 (SYSTEM_ARCHITECTURE.md §18.2).
 *
 * Holds a projection of core state and never an authority over it (ST-1).
 * Surface composition, theming, and settings land in later Sprint 1 commits.
 */
export function Shell(): React.JSX.Element {
  return <div data-devdesk-shell="root" />;
}
