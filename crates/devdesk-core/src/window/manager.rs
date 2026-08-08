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

use super::event::WindowEvent;

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

/// The window subsystem's authoritative view of the displays.
#[derive(Debug)]
pub struct WindowManager {
    graph: Arc<DisplayGraph>,
    generation: TopologyGeneration,
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
        }
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
    ) -> Result<Vec<WindowEvent>, ObserveError> {
        if transaction.generation() <= self.generation {
            return Err(ObserveError::Stale {
                held: self.generation,
                arrived: transaction.generation(),
            });
        }

        self.graph = Arc::clone(transaction.graph());
        self.generation = transaction.generation();

        Ok(vec![WindowEvent::TopologyAdopted {
            generation: self.generation,
            fingerprint: self.graph.fingerprint().clone(),
            monitors: self.graph.monitors().len(),
        }])
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
