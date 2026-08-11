/**
 * Stage 5A — Floating Status Dock Component
 */

export function StatusDock(): React.JSX.Element {
  return (
    <div className="devdesk-dock">
      <span style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa', paddingRight: 6, borderRight: '1px solid rgba(255, 255, 255, 0.08)' }}>
        DevDesk Dock
      </span>
      {[
        { label: 'Surface Host', key: 'host' },
        { label: 'Display Graph', key: 'graph' },
        { label: 'State Kernel', key: 'kernel' },
        { label: 'ADR-0004 Spec', key: 'spec' },
      ].map((item) => (
        <button key={item.key} type="button" className="devdesk-dock-item">
          {item.label}
        </button>
      ))}
    </div>
  );
}
