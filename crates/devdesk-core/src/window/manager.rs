//! The window subsystem's view of the desktop.
//!
//! `WindowManager` is the single consumer of the display subsystem inside the
//! core. Everything else in the window and layout path asks *it* where the
//! displays are, rather than reaching back to `devdesk-display` or, worse, to a
//! `PlatformBackend` (`ADR-0004` `ARCH-1`). One consumer means one answer.
//!
//! It holds a graph, not a topology. The graph is immutable (`WD-11`), so the
//! manager can hand the same snapshot to any number of callers and know that all
//! of them are reasoning about one desktop for as long as they hold it.
//!
//! ## What it does not do
//!
//! It does not place anything. It answers *which display* a surface belongs to;
//! it computes no coordinate, no size, and no anchor. Placement is the layout
//! actor's, and the boundary is the same one `ADR-0004` §4.3 draws for
//! `DisplayGraph`.

use std::sync::Arc;

use devdesk_display::{
    DisplayGraph, MonitorDescriptor, MonitorId, Topology, TopologyGeneration, TopologyTransaction,
};

use super::event::{AssociationReason, WindowCommand, WindowEvent};
use super::id::SurfaceId;
use super::outcome::WindowOutcome;
use super::reveal::{RevealError, RevealOutcome};
use super::surface::{AssociationIntent, SurfaceError, SurfaceManager};

/// Why a topology transaction was not adopted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ObserveError {
    /// The transaction is not newer than what the manager already holds.
    ///
    /// Delivery order is not guaranteed once transactions cross a channel, and a
    /// stale one applied after a fresh one would reinstate a desktop that has
    /// already been superseded — surfaces would move to displays that are no
    /// longer attached, which is exactly the silent arrangement change
    /// `AC-DAT-1.1` forbids.
    #[error("transaction generation {arrived:?} is not newer than the adopted {held:?}")]
    Stale {
        held: TopologyGeneration,
        arrived: TopologyGeneration,
    },
}

/// Why a surface operation failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WindowError {
    /// The surface registry refused.
    #[error(transparent)]
    Surface(#[from] SurfaceError),

    /// A caller assigned a surface to a display that is not attached.
    ///
    /// Rejected rather than accepted-and-corrected: a caller pointing at a
    /// display that is not there is working from a topology it no longer holds,
    /// and quietly substituting another display would place the surface
    /// somewhere nobody asked for.
    #[error("monitor {monitor} is not attached")]
    MonitorNotAttached { monitor: MonitorId },

    /// A reveal step was refused.
    #[error(transparent)]
    Reveal(#[from] RevealError),
}

/// Turns a reveal outcome into the event it warrants, if any.
///
/// A step that had already happened produces nothing. Emitting an event for it
/// would make "the surface reached `Revealed`" indistinguishable from "the
/// surface was already `Revealed` and something asked again", and a consumer
/// acting on the second would show a window that is already visible.
fn reveal_events(surface: &SurfaceId, outcome: RevealOutcome) -> Vec<WindowEvent> {
    match outcome.advanced() {
        Some((from, to)) => vec![WindowEvent::SurfaceRevealAdvanced {
            surface: surface.clone(),
            from,
            to,
        }],
        None => Vec::new(),
    }
}

/// The window subsystem's authoritative view of the displays and surfaces.
#[derive(Debug)]
pub struct WindowManager {
    graph: Arc<DisplayGraph>,
    generation: TopologyGeneration,
    surfaces: SurfaceManager,
}

impl Default for WindowManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowManager {
    /// Creates a manager that has not yet observed a topology.
    ///
    /// Its graph is empty and its generation is
    /// [`TopologyGeneration::INITIAL`]. That is not "no displays are attached" —
    /// it is "nobody has looked yet", and [`WindowManager::has_observed`]
    /// distinguishes them.
    #[must_use]
    pub fn new() -> Self {
        Self {
            graph: DisplayGraph::build(Arc::new(Topology::new(Vec::new()))),
            generation: TopologyGeneration::INITIAL,
            surfaces: SurfaceManager::new(),
        }
    }

    /// The surface registry.
    #[must_use]
    pub const fn surfaces(&self) -> &SurfaceManager {
        &self.surfaces
    }

    /// Registers a surface and associates it with a display.
    ///
    /// The association is `Initial`: there is no stored preference to honour
    /// yet, so the surface lands on [`WindowManager::default_monitor`] and does
    /// not acquire a preference from it. A caller restoring a saved arrangement
    /// follows with [`WindowManager::assign`], which does.
    ///
    /// A surface may be registered before any topology has been observed. It is
    /// then detached, which is a state the reveal sequence handles rather than
    /// an error — startup does not have to serialise enumeration against surface
    /// creation.
    ///
    /// # Errors
    ///
    /// [`WindowError::Surface`] if the identity is already registered.
    pub fn register_surface(&mut self, surface: SurfaceId) -> Result<WindowOutcome, WindowError> {
        let window = self.surfaces.register(surface.clone())?.window();

        let monitor = self.default_monitor_id();
        self.surfaces
            .associate(&surface, monitor.clone(), AssociationIntent::Fallback)?;

        let mut outcome = WindowOutcome::new();
        outcome.push_event(WindowEvent::SurfaceRegistered {
            surface: surface.clone(),
            window,
        });
        outcome.push_event(WindowEvent::SurfaceAssociated {
            surface: surface.clone(),
            from: None,
            to: monitor,
            reason: AssociationReason::Initial,
        });

        // The only creation command there is, and it is hidden. A surface has no
        // route to the screen except through the reveal sequence.
        outcome.push_command(WindowCommand::CreateHidden { surface, window });

        Ok(outcome)
    }

    /// Assigns a surface to a display, and records that it belongs there.
    ///
    /// This is how a restored arrangement is applied. Unlike the fallback
    /// associations made during a topology change, it sets the surface's
    /// preferred display, so a later undock/redock cycle returns it here.
    ///
    /// # Errors
    ///
    /// [`WindowError::Surface`] if the surface is unknown, and
    /// [`WindowError::MonitorNotAttached`] if the display is not attached.
    pub fn assign(
        &mut self,
        surface: &SurfaceId,
        monitor: &MonitorId,
    ) -> Result<WindowOutcome, WindowError> {
        if !self.is_attached(monitor) {
            return Err(WindowError::MonitorNotAttached {
                monitor: monitor.clone(),
            });
        }

        let from = self.surfaces.associate(
            surface,
            Some(monitor.clone()),
            AssociationIntent::Deliberate,
        )?;

        let mut outcome = WindowOutcome::new();
        outcome.push_event(WindowEvent::SurfaceAssociated {
            surface: surface.clone(),
            from,
            to: Some(monitor.clone()),
            reason: AssociationReason::Assigned,
        });

        // Assignment itself produces no command: which display a surface belongs
        // to is association, and moving a window there is placement. The one
        // exception is a show already owed to a surface that had nowhere to
        // appear — giving it a display is what discharges that.
        outcome.absorb(self.issue_pending_show(surface));

        Ok(outcome)
    }

    /// The host reports that a surface's window now exists.
    ///
    /// Advances `Created` → `Attached`. The window is hidden at this point and
    /// stays hidden: existing is not the same as being ready to look at.
    ///
    /// # Errors
    ///
    /// [`WindowError::Surface`] if the surface is unknown, and
    /// [`WindowError::Reveal`] if the step is refused.
    pub fn note_window_created(
        &mut self,
        surface: &SurfaceId,
    ) -> Result<WindowOutcome, WindowError> {
        let advanced = self.surfaces.reveal_mut(surface)?.attach()?;

        let mut outcome = WindowOutcome::new();
        outcome.extend_events(reveal_events(surface, advanced));
        Ok(outcome)
    }

    /// The host reports that a surface has painted its first frame.
    ///
    /// Advances `Attached` → `FirstFrameReady` and then immediately reveals.
    /// The two are one operation on purpose: `AC-FRE-1.1` is that a surface
    /// becomes visible **when** its content is ready, and leaving the reveal to
    /// a separate call would create a window in which a caller could forget,
    /// delay, or reorder it. There is nothing to decide between the two states —
    /// the frame is ready, so the surface is shown.
    ///
    /// Signalling again after the first time changes nothing and emits nothing.
    /// A webview that reloads reports another first frame, and hiding and
    /// re-showing for it would produce the flash on every reload that this
    /// mechanism exists to prevent.
    ///
    /// # Errors
    ///
    /// [`WindowError::Surface`] if the surface is unknown, and
    /// [`WindowError::Reveal`] if no window has been reported for it — a frame
    /// cannot be ready for a window nobody created.
    pub fn note_first_frame(&mut self, surface: &SurfaceId) -> Result<WindowOutcome, WindowError> {
        let machine = self.surfaces.reveal_mut(surface)?;

        let painted = machine.first_frame()?;
        let mut outcome = WindowOutcome::new();
        outcome.extend_events(reveal_events(surface, painted));

        // Only from the transition. A surface that was already revealed does not
        // reveal again, and one that could not paint never reaches here.
        if painted.advanced().is_some() {
            let revealed = machine.reveal()?;
            outcome.extend_events(reveal_events(surface, revealed));

            // The surface has painted, so it is owed a show. Reaching `Revealed`
            // is what makes the debt legitimate — the chain from
            // `FirstFrameReady` is the no-flash guarantee — but it does not by
            // itself decide when the command goes out.
            if revealed.revealed_now() {
                self.surfaces.set_show_pending(surface, true)?;
                outcome.absorb(self.issue_pending_show(surface));
            }
        }

        Ok(outcome)
    }

    /// Issues an owed show command, if the surface has somewhere to be shown.
    ///
    /// A surface can reach `Revealed` while no display is attached: it painted
    /// into a hidden window on a machine whose lid has just closed. Showing it
    /// then would ask the windowing system to make something visible on a
    /// desktop that has no visible area, and where the window lands when a
    /// display returns is nobody's decision. So the command waits, and the debt
    /// is discharged by the next association that gives the surface a display.
    ///
    /// This is also the recovery path for a show the windowing system refused:
    /// the debt is still recorded, and the next association reissues it.
    fn issue_pending_show(&self, surface: &SurfaceId) -> WindowOutcome {
        let mut outcome = WindowOutcome::new();

        let Some(record) = self.surfaces.get(surface) else {
            return outcome;
        };

        if record.is_show_pending() && record.monitor().is_some() {
            outcome.push_command(WindowCommand::Show {
                surface: surface.clone(),
                window: record.window(),
            });
        }

        outcome
    }

    /// Records that a show command reached the windowing system.
    ///
    /// Called by [`super::SurfaceHost`] after the command succeeded, so a
    /// refusal leaves the debt outstanding rather than silently dropping it.
    ///
    /// # Errors
    ///
    /// [`WindowError::Surface`] if the surface was removed between issuing the
    /// command and confirming it.
    pub fn confirm_shown(&mut self, surface: &SurfaceId) -> Result<(), WindowError> {
        self.surfaces.set_show_pending(surface, false)?;
        Ok(())
    }

    /// Removes a surface and retires its window.
    ///
    /// # Errors
    ///
    /// [`WindowError::Surface`] if the surface is not registered.
    pub fn remove_surface(&mut self, surface: &SurfaceId) -> Result<WindowOutcome, WindowError> {
        let record = self
            .surfaces
            .remove(surface)
            .ok_or_else(|| SurfaceError::Unknown {
                surface: surface.clone(),
            })?;

        let mut outcome = WindowOutcome::new();
        outcome.push_event(WindowEvent::SurfaceRemoved {
            surface: surface.clone(),
            window: record.window(),
        });
        outcome.push_command(WindowCommand::Destroy {
            surface: surface.clone(),
            window: record.window(),
        });

        Ok(outcome)
    }

    /// Re-associates every surface against the current topology.
    ///
    /// Three cases, in priority order:
    ///
    /// 1. **The preferred display is attached and the surface is elsewhere** —
    ///    it goes home (`MonitorReturned`). This is what makes a dock/undock
    ///    round trip return the desktop to where it started rather than eroding
    ///    it one cycle at a time.
    /// 2. **The current display is gone** — the surface falls back to the
    ///    default (`MonitorRemoved`), or to nothing if no display is attached
    ///    (`NoDisplaysAttached`). A fallback never overwrites the preference.
    /// 3. **Otherwise** — nothing changes and no event is emitted. A topology
    ///    change that does not affect a surface must not look like one that
    ///    does, or every consumer re-does work for every unrelated display
    ///    event.
    /// 4. **Any surface that still owes a show and now has a display** gets the
    ///    command reissued, whether or not its association moved. One pass at
    ///    the end rather than inside the loop, so a surface that both moved and
    ///    owed a show gets exactly one command rather than two.
    fn reassociate_all(&mut self) -> WindowOutcome {
        let default = self.default_monitor_id();
        let mut outcome = WindowOutcome::new();

        for id in self.surfaces.ids() {
            let Some(record) = self.surfaces.get(&id) else {
                continue;
            };

            let current = record.monitor().cloned();
            let preferred = record.preferred_monitor().cloned();

            let (target, reason) = match preferred {
                // 1. Home is available.
                Some(home) if self.is_attached(&home) => {
                    if current.as_ref() == Some(&home) {
                        continue;
                    }
                    (Some(home), AssociationReason::MonitorReturned)
                }
                // 2. Home is unavailable, or there is none.
                _ => {
                    let still_attached = current
                        .as_ref()
                        .is_some_and(|monitor| self.is_attached(monitor));
                    if still_attached {
                        continue;
                    }
                    let reason = if default.is_some() {
                        AssociationReason::MonitorRemoved
                    } else {
                        AssociationReason::NoDisplaysAttached
                    };
                    (default.clone(), reason)
                }
            };

            if current == target {
                continue;
            }

            // A surface going home is honouring the caller's own choice, so the
            // preference is reasserted rather than left to drift.
            let intent = if reason == AssociationReason::MonitorReturned {
                AssociationIntent::Deliberate
            } else {
                AssociationIntent::Fallback
            };

            if let Ok(from) = self.surfaces.associate(&id, target.clone(), intent) {
                outcome.push_event(WindowEvent::SurfaceAssociated {
                    surface: id,
                    from,
                    to: target,
                    reason,
                });
            }
        }

        // A topology change is the natural moment to settle outstanding shows:
        // it is when a detached surface gains a display, and it is rare enough
        // that reissuing a refused command here cannot become a spin.
        for id in self.surfaces.ids() {
            outcome.absorb(self.issue_pending_show(&id));
        }

        outcome
    }

    /// Adopts a topology transaction.
    ///
    /// # Errors
    ///
    /// [`ObserveError::Stale`] when the transaction is not newer than the
    /// adopted one. Rejected rather than ignored: a caller replaying an old
    /// transaction has a bug, and silently discarding it would hide the bug
    /// while leaving the symptom.
    pub fn observe(
        &mut self,
        transaction: &TopologyTransaction,
    ) -> Result<WindowOutcome, ObserveError> {
        if transaction.generation() <= self.generation {
            return Err(ObserveError::Stale {
                held: self.generation,
                arrived: transaction.generation(),
            });
        }

        self.graph = Arc::clone(transaction.graph());
        self.generation = transaction.generation();

        let mut outcome = WindowOutcome::new();
        outcome.push_event(WindowEvent::TopologyAdopted {
            generation: self.generation,
            fingerprint: self.graph.fingerprint().clone(),
            monitors: self.graph.monitors().len(),
        });

        // Association happens after the graph is swapped, so every decision it
        // makes is against the new desktop. Doing it before would associate
        // against a topology the manager has already been told is gone.
        //
        // The only command it can produce is a show that was already owed to a
        // surface that had painted with nowhere to appear. A display change
        // never moves a window — that is placement — and a surface that has not
        // painted stays hidden through a docking event.
        outcome.absorb(self.reassociate_all());

        Ok(outcome)
    }

    /// The current spatial index.
    ///
    /// Immutable, so a caller may hold it across arbitrary work and keep
    /// querying one consistent desktop even while a newer one is adopted.
    #[must_use]
    pub fn graph(&self) -> &Arc<DisplayGraph> {
        &self.graph
    }

    /// The generation of the adopted topology.
    ///
    /// Process-local (`TP-14`). Compare it within this run; never store it.
    #[must_use]
    pub const fn generation(&self) -> TopologyGeneration {
        self.generation
    }

    /// Whether any topology has been adopted.
    #[must_use]
    pub fn has_observed(&self) -> bool {
        self.generation != TopologyGeneration::INITIAL
    }

    /// Whether any display is attached.
    #[must_use]
    pub fn has_displays(&self) -> bool {
        !self.graph.monitors().is_empty()
    }

    /// The display a surface binds to when it has no better answer.
    ///
    /// `WD-5`: an unknown topology **must** resolve deterministically. The
    /// primary display is the deterministic choice, and where the platform names
    /// none, the first in identity order — never the first in enumeration order,
    /// which is the ordering `WD-3` exists to stop depending on.
    ///
    /// This is *association*, not placement: it answers which display, never
    /// where on it.
    #[must_use]
    pub fn default_monitor(&self) -> Option<&MonitorDescriptor> {
        self.graph
            .primary()
            .or_else(|| self.graph.monitors().first())
    }

    /// The identity of [`WindowManager::default_monitor`].
    #[must_use]
    pub fn default_monitor_id(&self) -> Option<MonitorId> {
        self.default_monitor().map(|monitor| monitor.id().clone())
    }

    /// Whether a display is currently attached.
    #[must_use]
    pub fn is_attached(&self, monitor: &MonitorId) -> bool {
        self.graph.find(monitor).is_some()
    }
}
