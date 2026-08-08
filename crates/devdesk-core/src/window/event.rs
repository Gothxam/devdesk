//! What the window subsystem says about its own state.
//!
//! A [`WindowEvent`] is a **statement of fact**: it describes something that has
//! already happened to the manager's state. Nobody has to act on one, and
//! ignoring one cannot corrupt anything.
//!
//! Requests to the host — create this window, show it — are a separate
//! vocabulary arriving with hidden surface creation. Keeping the two apart is
//! what keeps this crate free of Tauri: the manager decides *what should be
//! true* and has no idea what a webview is.

use devdesk_display::{MonitorId, TopologyFingerprint, TopologyGeneration};

use super::id::{SurfaceId, WindowId};
use super::reveal::RevealState;

/// Why a surface's monitor association changed.
///
/// Carried because the remedies differ. A surface that moved because its display
/// was unplugged may warrant the `WD-5` restore offer; one that moved because a
/// caller asked does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssociationReason {
    /// A caller assigned this display. The surface now belongs here.
    Assigned,
    /// First association, on registration, with no stored preference to honour.
    Initial,
    /// The display it was on is no longer attached.
    MonitorRemoved,
    /// No display is attached at all.
    NoDisplaysAttached,
    /// Its preferred display came back, and the surface went home.
    ///
    /// A **restoration**, not an unrequested change: it is the arrangement the
    /// caller last asked for (`AC-DAT-1.1`).
    MonitorReturned,
}

/// Something that has happened to the window subsystem's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowEvent {
    /// A new topology was adopted.
    ///
    /// Carries the fingerprint as well as the generation because they answer
    /// different questions and a consumer usually needs both: the fingerprint to
    /// look up a stored arrangement (`WD-4`), the generation to tell whether
    /// work it is holding is stale (`ADR-0004` `TP-7`). `TP-14` forbids storing
    /// the generation; it is here to be compared within this process and
    /// discarded.
    TopologyAdopted {
        generation: TopologyGeneration,
        fingerprint: TopologyFingerprint,
        monitors: usize,
    },

    /// A surface was registered and given a window identity.
    SurfaceRegistered {
        surface: SurfaceId,
        window: WindowId,
    },

    /// A surface's monitor association changed.
    ///
    /// `to` is `None` when no display is attached. That is a real state and not
    /// a reason to destroy the surface, which would lose the arrangement rather
    /// than suspend it.
    SurfaceAssociated {
        surface: SurfaceId,
        from: Option<MonitorId>,
        to: Option<MonitorId>,
        reason: AssociationReason,
    },

    /// A surface advanced toward being visible.
    ///
    /// Emitted only on an actual transition. Repeating a step that has already
    /// happened — a webview reloading and signalling its first frame again —
    /// changes nothing and says nothing.
    SurfaceRevealAdvanced {
        surface: SurfaceId,
        from: RevealState,
        to: RevealState,
    },

    /// A surface was removed and its window retired.
    SurfaceRemoved {
        surface: SurfaceId,
        window: WindowId,
    },
}
