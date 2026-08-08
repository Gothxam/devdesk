//! What the window subsystem says, and what it asks for.
//!
//! Two vocabularies, deliberately separate:
//!
//! - A [`WindowEvent`] is a **statement of fact**. It describes something that
//!   has already happened to the manager's state. Nobody has to act on one, and
//!   ignoring one cannot corrupt anything.
//! - A [`WindowCommand`] is a **request to the host**. It is the only way this
//!   crate touches a real window, and every one is executed by `apps/desktop`
//!   against Tauri.
//!
//! Keeping them apart is what keeps this crate free of Tauri. The manager
//! decides *that* a window should be created hidden and *that* it should be
//! shown once its first frame has arrived; it has no idea what a webview is.
//!
//! It is also what makes the reveal invariant checkable. A command list is a
//! value, so "no show was ever emitted before the surface painted" is an
//! assertion over data rather than an observation of a running window.

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

/// A request to the host to do something to a real window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowCommand {
    /// Create the host window for a surface.
    ///
    /// There is **no `visible` field**, and that is the design. A surface window
    /// is always created hidden (`AC-FRE-1.1`); offering the choice would make
    /// the flash a mistake a caller could make rather than a state the system
    /// cannot reach. Visibility is reachable only through [`WindowCommand::Show`].
    CreateHidden {
        surface: SurfaceId,
        window: WindowId,
    },

    /// Make a window visible.
    ///
    /// Emitted only on the transition into
    /// [`RevealState::Revealed`](super::reveal::RevealState::Revealed), which is
    /// reachable only from `FirstFrameReady`. That chain is the no-flash
    /// guarantee, and it holds by construction rather than by discipline.
    Show {
        surface: SurfaceId,
        window: WindowId,
    },

    /// Destroy a window.
    Destroy {
        surface: SurfaceId,
        window: WindowId,
    },
}

impl WindowCommand {
    /// The window this command addresses.
    #[must_use]
    pub const fn window(&self) -> WindowId {
        match self {
            Self::CreateHidden { window, .. }
            | Self::Show { window, .. }
            | Self::Destroy { window, .. } => *window,
        }
    }

    /// The surface this command is on behalf of.
    #[must_use]
    pub const fn surface(&self) -> &SurfaceId {
        match self {
            Self::CreateHidden { surface, .. }
            | Self::Show { surface, .. }
            | Self::Destroy { surface, .. } => surface,
        }
    }

    /// Whether executing this command puts something on screen.
    ///
    /// Exists so the no-flash property can be asserted over a command list
    /// without matching on variants at every assertion site.
    #[must_use]
    pub const fn makes_visible(&self) -> bool {
        matches!(self, Self::Show { .. })
    }
}
