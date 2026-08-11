//! What host windows a topology calls for.

use std::collections::BTreeMap;

use devdesk_display::{DisplayGraph, MonitorId, PhysicalPoint, PhysicalRect};

/// Identifies one desktop host window.
///
/// Derived from the monitor it covers, because that is what it *is*: there is
/// exactly one host window per monitor and it exists for as long as the monitor
/// does. A separate allocated id would need a mapping back to the monitor, and
/// the mapping is the only thing anyone would ever ask it for.
///
/// Process-local, like [`crate::window::WindowId`] and for the same reason: it
/// names a live window, and a window does not survive a restart.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct HostWindowId(MonitorId);

impl HostWindowId {
    /// The host window for a monitor.
    #[must_use]
    pub const fn for_monitor(monitor: MonitorId) -> Self {
        Self(monitor)
    }

    /// The monitor this window covers.
    #[must_use]
    pub const fn monitor(&self) -> &MonitorId {
        &self.0
    }
}

impl core::fmt::Display for HostWindowId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "host:{}", self.0.as_str())
    }
}

/// One desktop host window: a monitor's worth of desktop.
#[derive(Debug, Clone, PartialEq)]
pub struct HostWindow {
    /// Which window this is.
    pub id: HostWindowId,

    /// Where it goes, in **virtual-screen** physical coordinates (`DH-14`).
    ///
    /// A monitor to the left of the primary has a negative origin, and that is
    /// not an error to be clamped away — it is where the monitor is. `WorkerW`'s
    /// client coordinates are this same space, which is what makes the host
    /// window's rectangle usable without conversion.
    pub bounds: PhysicalRect,

    /// This monitor's scale factor, so the webview it hosts can lay out in
    /// logical pixels without asking a second source (`WD-2`).
    pub scale_factor: f64,

    /// Whether this covers the primary monitor.
    ///
    /// Not used for placement — every host window is equal — but a caller that
    /// must pick one window for a single-window fallback needs an answer that
    /// does not depend on enumeration order.
    pub is_primary: bool,
}

/// What has to happen to reach the planned set.
///
/// Ordered by the caller, not by this type: `Create` and `Move` are independent
/// of each other, and `Destroy` last is the caller's choice about how much
/// flicker to accept. What this guarantees is only that the set is complete and
/// that no window appears in two changes.
#[derive(Debug, Clone, PartialEq)]
pub enum HostWindowChange {
    /// A monitor appeared, or this is the first plan.
    Create(HostWindow),

    /// A monitor moved, resized, or changed scale.
    ///
    /// Carries the whole window rather than a delta: a caller applying a delta
    /// has to hold the previous state to interpret it, and holding state that
    /// the plan already has is how the two drift apart.
    Move(HostWindow),

    /// A monitor went away.
    Destroy(HostWindowId),
}

/// The host windows a topology calls for.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HostPlan {
    windows: BTreeMap<HostWindowId, HostWindow>,
}

impl HostPlan {
    /// The empty plan: no displays, therefore no host windows.
    ///
    /// A real state, not a failure. A laptop with the lid closed and no external
    /// display attached has nowhere to put a desktop, and the honest answer is
    /// zero windows rather than one window somewhere invented.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// The plan for a topology.
    ///
    /// Uses `bounds`, not `work_area`. A desktop host window covers the whole
    /// monitor — the wallpaper does — and the taskbar sits in front of it. Using
    /// the work area would leave a strip of desktop the widgets could never
    /// reach even when the taskbar auto-hides.
    #[must_use]
    pub fn for_graph(graph: &DisplayGraph) -> Self {
        let windows = graph
            .monitors()
            .iter()
            .map(|monitor| {
                let id = HostWindowId::for_monitor(monitor.identity.id().clone());

                let window = HostWindow {
                    id: id.clone(),
                    bounds: monitor.bounds,
                    scale_factor: monitor.scale_factor.get(),
                    is_primary: monitor.is_primary,
                };

                (id, window)
            })
            .collect();

        Self { windows }
    }

    /// Every planned window, in a stable order.
    #[must_use]
    pub fn windows(&self) -> impl ExactSizeIterator<Item = &HostWindow> {
        self.windows.values()
    }

    /// How many host windows this plan calls for.
    #[must_use]
    pub fn len(&self) -> usize {
        self.windows.len()
    }

    /// Whether this plan calls for no windows at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }

    /// The planned window for a monitor, if it has one.
    #[must_use]
    pub fn get(&self, id: &HostWindowId) -> Option<&HostWindow> {
        self.windows.get(id)
    }

    /// The top-left of the virtual screen: the smallest origin any monitor has.
    ///
    /// `WorkerW` spans the whole virtual screen and its **client** origin is
    /// this point, not the primary monitor's `(0, 0)`. A host window's position
    /// inside it is therefore `bounds.origin - virtual_origin()`, and skipping
    /// the subtraction puts every window on a left-of-primary desk at the wrong
    /// place by the width of whatever is to the left.
    ///
    /// `(0, 0)` when there are no monitors, which is the only answer available
    /// and is never used — an empty plan has no window to position.
    #[must_use]
    pub fn virtual_origin(&self) -> PhysicalPoint {
        let x = self
            .windows
            .values()
            .map(|window| window.bounds.origin.x)
            .min()
            .unwrap_or(0);

        let y = self
            .windows
            .values()
            .map(|window| window.bounds.origin.y)
            .min()
            .unwrap_or(0);

        PhysicalPoint { x, y }
    }

    /// What has to change to get from `self` to `next`.
    ///
    /// A window whose geometry and scale are unchanged produces **no change at
    /// all**. That is the whole point on a hotplug: replugging a second monitor
    /// must not tear down and rebuild the first one's desktop, which the user
    /// would see as a flash on a display nothing happened to (`AC-FRE-1.1`).
    #[must_use]
    pub fn changes_to(&self, next: &Self) -> Vec<HostWindowChange> {
        let mut changes = Vec::new();

        for (id, window) in &next.windows {
            match self.windows.get(id) {
                None => changes.push(HostWindowChange::Create(window.clone())),
                Some(current) if current != window => {
                    changes.push(HostWindowChange::Move(window.clone()));
                }
                Some(_) => {}
            }
        }

        for id in self.windows.keys() {
            if !next.windows.contains_key(id) {
                changes.push(HostWindowChange::Destroy(id.clone()));
            }
        }

        changes
    }
}
