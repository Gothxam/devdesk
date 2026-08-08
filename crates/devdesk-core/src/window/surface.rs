//! The registry of surfaces and which display each is on.
//!
//! ## Where a surface *is* and where it *belongs* are two fields
//!
//! Undocking moves a surface to the laptop panel because its display left.
//! Redocking must put it back — not leave it where the fallback dropped it,
//! which is `PS-3` in slow motion: the arrangement erodes one docking cycle at a
//! time, and no single step looks like a bug.
//!
//! So a record carries both:
//!
//! | Field | Meaning | Changed by |
//! | --- | --- | --- |
//! | `monitor` | Where the surface is now | Any association, including a fallback |
//! | `preferred` | Where it belongs when that display is available | Only a deliberate assignment |
//!
//! A fallback never overwrites a preference. That is what makes a dock/undock
//! round trip return the desktop to where it started, and it is why returning a
//! surface to its preferred display when that display comes back is a
//! *restoration* rather than the unrequested arrangement change `AC-DAT-1.1`
//! forbids — it is the arrangement the caller last asked for.
//!
//! ## No placement
//!
//! Association only: which display, never where on it. A record holds no
//! coordinate, no size, and no anchor.

use std::collections::BTreeMap;

use devdesk_display::MonitorId;

use super::id::{SurfaceId, WindowId, WindowIdAllocator};
use super::reveal::{RevealState, RevealStateMachine};

/// Why a surface registry operation failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SurfaceError {
    /// A surface with this identity is already registered.
    ///
    /// An error rather than a silent replacement: registering twice means two
    /// callers believe they own one surface, and the second would take over a
    /// window the first is still driving.
    #[error("surface {surface} is already registered")]
    AlreadyRegistered { surface: SurfaceId },

    /// No surface with this identity is registered.
    #[error("surface {surface} is not registered")]
    Unknown { surface: SurfaceId },
}

/// Whether an association reflects what the caller wants or what is available.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssociationIntent {
    /// The caller asked for this display. Updates the preference.
    Deliberate,
    /// The best available answer, made because the preferred display is not
    /// attached. Leaves the preference alone so it can be honoured later.
    Fallback,
}

/// One registered surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceRecord {
    surface: SurfaceId,
    window: WindowId,
    monitor: Option<MonitorId>,
    preferred: Option<MonitorId>,
    reveal: RevealStateMachine,
    pending_show: bool,
}

impl SurfaceRecord {
    #[must_use]
    pub const fn surface(&self) -> &SurfaceId {
        &self.surface
    }

    #[must_use]
    pub const fn window(&self) -> WindowId {
        self.window
    }

    /// The display this surface is currently on.
    ///
    /// `None` when no display is attached. A real state — a closed lid with
    /// nothing plugged in — and never a reason to destroy the surface, which
    /// would lose the arrangement rather than suspend it.
    #[must_use]
    pub const fn monitor(&self) -> Option<&MonitorId> {
        self.monitor.as_ref()
    }

    /// The display this surface belongs on when it is available.
    #[must_use]
    pub const fn preferred_monitor(&self) -> Option<&MonitorId> {
        self.preferred.as_ref()
    }

    /// How far this surface has progressed toward being visible.
    #[must_use]
    pub const fn reveal(&self) -> RevealStateMachine {
        self.reveal
    }

    /// The reveal state.
    #[must_use]
    pub const fn reveal_state(&self) -> RevealState {
        self.reveal.state()
    }

    /// Whether this surface is on screen.
    #[must_use]
    pub const fn is_visible(&self) -> bool {
        self.reveal.is_visible()
    }

    /// Whether the surface should be on screen but the host has not shown it yet.
    ///
    /// True in two situations, both temporary:
    ///
    /// - the surface painted while no display was attached, so there was nowhere
    ///   to show it;
    /// - the show command was issued and the windowing system refused it.
    ///
    /// Either way the reveal state has already moved to `Revealed` — the surface
    /// *has* painted, which is what that state means — and the outstanding work
    /// is a command, not a transition. The show is reissued the next time the
    /// surface gains a display.
    #[must_use]
    pub const fn is_show_pending(&self) -> bool {
        self.pending_show
    }

    /// Whether the surface is somewhere other than where it belongs.
    #[must_use]
    pub fn is_displaced(&self) -> bool {
        match (&self.preferred, &self.monitor) {
            (Some(preferred), Some(monitor)) => preferred != monitor,
            (Some(_), None) => true,
            _ => false,
        }
    }
}

/// Every surface the window subsystem knows about.
///
/// Iteration is ordered by surface identity, not by registration order.
/// Registration order is an accident of startup timing, and a consumer that
/// derived anything from it would produce a different result on a run where two
/// surfaces registered in the other order — the same class of instability
/// `WD-3` removes from monitors.
#[derive(Debug, Default)]
pub struct SurfaceManager {
    surfaces: BTreeMap<SurfaceId, SurfaceRecord>,
    windows: WindowIdAllocator,
}

impl SurfaceManager {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            surfaces: BTreeMap::new(),
            windows: WindowIdAllocator::new(),
        }
    }

    /// Registers a surface and allocates its window identity.
    ///
    /// The surface starts with no monitor and no preference. Association is a
    /// separate step because it needs a topology, and a surface may legitimately
    /// be registered before one has been observed.
    ///
    /// # Errors
    ///
    /// [`SurfaceError::AlreadyRegistered`] if the identity is in use.
    pub fn register(&mut self, surface: SurfaceId) -> Result<&SurfaceRecord, SurfaceError> {
        if self.surfaces.contains_key(&surface) {
            return Err(SurfaceError::AlreadyRegistered { surface });
        }

        let record = SurfaceRecord {
            surface: surface.clone(),
            window: self.windows.allocate(),
            monitor: None,
            preferred: None,
            reveal: RevealStateMachine::new(),
            pending_show: false,
        };

        Ok(self.surfaces.entry(surface).or_insert(record))
    }

    /// Removes a surface, returning what it was.
    pub fn remove(&mut self, surface: &SurfaceId) -> Option<SurfaceRecord> {
        self.surfaces.remove(surface)
    }

    /// Points a surface at a display.
    ///
    /// Returns the display it was on, so a caller can report the change without
    /// having read the record first.
    ///
    /// # Errors
    ///
    /// [`SurfaceError::Unknown`] if the surface is not registered.
    pub fn associate(
        &mut self,
        surface: &SurfaceId,
        monitor: Option<MonitorId>,
        intent: AssociationIntent,
    ) -> Result<Option<MonitorId>, SurfaceError> {
        let record = self
            .surfaces
            .get_mut(surface)
            .ok_or_else(|| SurfaceError::Unknown {
                surface: surface.clone(),
            })?;

        let previous = record.monitor.clone();
        record.monitor = monitor.clone();

        // A fallback deliberately does not touch the preference. Overwriting it
        // is how an arrangement erodes across docking cycles.
        if intent == AssociationIntent::Deliberate {
            record.preferred = monitor;
        }

        Ok(previous)
    }

    #[must_use]
    pub fn get(&self, surface: &SurfaceId) -> Option<&SurfaceRecord> {
        self.surfaces.get(surface)
    }

    #[must_use]
    pub fn contains(&self, surface: &SurfaceId) -> bool {
        self.surfaces.contains_key(surface)
    }

    /// Every surface, in identity order.
    pub fn iter(&self) -> impl Iterator<Item = &SurfaceRecord> {
        self.surfaces.values()
    }

    /// The surfaces currently on a display, in identity order.
    #[must_use]
    pub fn on_monitor(&self, monitor: &MonitorId) -> Vec<&SurfaceRecord> {
        self.surfaces
            .values()
            .filter(|record| record.monitor.as_ref() == Some(monitor))
            .collect()
    }

    /// The surfaces with no display, in identity order.
    #[must_use]
    pub fn detached(&self) -> Vec<&SurfaceRecord> {
        self.surfaces
            .values()
            .filter(|record| record.monitor.is_none())
            .collect()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.surfaces.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.surfaces.is_empty()
    }

    /// Surface identities in iteration order.
    ///
    /// Used where an operation mutates records while walking them, which a
    /// borrow of `iter()` would not allow.
    pub(super) fn ids(&self) -> Vec<SurfaceId> {
        self.surfaces.keys().cloned().collect()
    }

    /// Mutable access to one record's reveal machine.
    ///
    /// Crate-internal: reveal steps are driven through [`super::WindowManager`],
    /// which is where the show command is emitted from. Handing a caller a
    /// mutable machine would let it advance the state without the command that
    /// makes the state true of a real window.
    pub(super) fn reveal_mut(
        &mut self,
        surface: &SurfaceId,
    ) -> Result<&mut RevealStateMachine, SurfaceError> {
        self.surfaces
            .get_mut(surface)
            .map(|record| &mut record.reveal)
            .ok_or_else(|| SurfaceError::Unknown {
                surface: surface.clone(),
            })
    }

    /// Marks a surface as owing, or no longer owing, a show command.
    ///
    /// Crate-internal for the same reason as [`SurfaceManager::reveal_mut`]:
    /// whether a show is outstanding is only meaningful alongside the command
    /// that discharges it, and both are [`super::WindowManager`]'s to decide.
    pub(super) fn set_show_pending(
        &mut self,
        surface: &SurfaceId,
        pending: bool,
    ) -> Result<(), SurfaceError> {
        self.surfaces
            .get_mut(surface)
            .map(|record| record.pending_show = pending)
            .ok_or_else(|| SurfaceError::Unknown {
                surface: surface.clone(),
            })
    }

    /// The surfaces that have painted but are not on screen, in identity order.
    ///
    /// Empty on a healthy desktop. A non-empty list means either that displays
    /// are unplugged or that the windowing system refused a show, and both are
    /// worth being able to ask about.
    #[must_use]
    pub fn awaiting_show(&self) -> Vec<&SurfaceRecord> {
        self.surfaces
            .values()
            .filter(|record| record.is_show_pending())
            .collect()
    }

    /// The surfaces currently on screen, in identity order.
    #[must_use]
    pub fn visible(&self) -> Vec<&SurfaceRecord> {
        self.surfaces
            .values()
            .filter(|record| record.is_visible())
            .collect()
    }
}
