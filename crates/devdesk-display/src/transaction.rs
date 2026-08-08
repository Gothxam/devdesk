//! Topology changes as transactions.
//!
//! ## The guarantee
//!
//! A consumer never observes an intermediate topology. Between "two displays"
//! and "one display" there is no moment where the arrangement is half-updated,
//! no window where the graph disagrees with the topology it indexes, and no way
//! to read a generation that does not match the displays alongside it.
//!
//! This is not a convenience. Undocking produces a burst of platform events; a
//! consumer that read topology per event would see the external display gone
//! while the laptop panel still reported its docked resolution, place surfaces
//! against that arrangement, and then place them again. The user watches their
//! desktop rearrange twice, and the second arrangement is the only correct one.
//!
//! ## How it holds
//!
//! Everything expensive — the new topology, its diff against the old one, the
//! new graph — is computed **outside** the lock. The lock is then taken to swap
//! one struct. A reader holds the read lock only long enough to clone two
//! `Arc`s, so it observes either the whole previous state or the whole next one.
//!
//! ## Why the generation exists
//!
//! `TopologyFingerprint` answers "which arrangement is this", and two visits to
//! the same desk produce the same fingerprint — that is what makes it a layout
//! key (WD-4). [`TopologyGeneration`] answers "how recent is this", strictly
//! increasing, so a consumer holding stale work can tell that it is stale. A
//! fingerprint cannot do that job: undock and redock returns to a fingerprint
//! already seen.

use std::sync::{Arc, RwLock};

use crate::diff::TopologyDiff;
use crate::graph::DisplayGraph;
use crate::topology::Topology;

/// How many times the topology has been published, strictly increasing.
///
/// Generation 0 means nothing has been enumerated yet — not that no displays are
/// attached, which is a different fact and reports as an empty topology at
/// generation 1.
///
/// # Process-local; never persisted
///
/// `TP-14`: this counts publications made by **one running process**. A stored
/// generation is meaningless on the next launch, and worse, it still *compares* —
/// a saved `7` and a fresh `3` order against each other perfectly happily, so a
/// consumer reasoning about staleness across a restart would conclude that the
/// arrangement it just enumerated is older than the one it saved, and discard it.
///
/// **The absence of `Serialize` and `Deserialize` here is deliberate and
/// load-bearing.** [`TopologyFingerprint`](crate::topology::TopologyFingerprint)
/// derives them and is the layout key (`WD-4`); this type must not become
/// storable by someone adding a derive to make a struct compile. Continuity
/// across a restart is the fingerprint's job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TopologyGeneration(u64);

impl TopologyGeneration {
    /// Before any enumeration has been published.
    pub const INITIAL: Self = Self(0);

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    const fn next(self) -> Self {
        Self(self.0.saturating_add(1))
    }
}

/// One complete, atomic topology change.
///
/// Carries both arrangements and the difference between them, so a consumer has
/// everything it needs from one value and never has to remember what it saw last
/// — remembered state is what drifts out of step with the thing it describes.
#[derive(Debug, Clone)]
pub struct TopologyTransaction {
    generation: TopologyGeneration,
    previous: Option<Arc<Topology>>,
    previous_graph: Option<Arc<DisplayGraph>>,
    current: Arc<Topology>,
    graph: Arc<DisplayGraph>,
    diff: TopologyDiff,
}

impl TopologyTransaction {
    /// Which publication this is.
    #[must_use]
    pub const fn generation(&self) -> TopologyGeneration {
        self.generation
    }

    /// The arrangement before this change.
    ///
    /// `None` for the first publication. Modelled as absent rather than as an
    /// empty topology because the two are genuinely different: a consumer
    /// restoring a saved arrangement at startup does something different from
    /// one reacting to every display being unplugged, and collapsing them makes
    /// the first case indistinguishable from the second.
    #[must_use]
    pub fn previous(&self) -> Option<&Arc<Topology>> {
        self.previous.as_ref()
    }

    /// The spatial index over the previous arrangement.
    ///
    /// Carried because migrating a layout needs to ask where a surface *was* as
    /// well as where it can go, and rebuilding the old graph to answer that
    /// would rebuild something the publisher already had.
    #[must_use]
    pub fn previous_graph(&self) -> Option<&Arc<DisplayGraph>> {
        self.previous_graph.as_ref()
    }

    /// The arrangement now.
    #[must_use]
    pub fn current(&self) -> &Arc<Topology> {
        &self.current
    }

    /// The spatial index over the current arrangement.
    ///
    /// Built once by the publisher and shared, so N consumers reacting to one
    /// change share one index rather than building N identical ones.
    #[must_use]
    pub fn graph(&self) -> &Arc<DisplayGraph> {
        &self.graph
    }

    /// What changed.
    #[must_use]
    pub const fn diff(&self) -> &TopologyDiff {
        &self.diff
    }

    /// Whether this is the first arrangement ever observed.
    #[must_use]
    pub const fn is_initial(&self) -> bool {
        self.previous.is_none()
    }
}

/// The published state, swapped as one value.
#[derive(Debug, Clone)]
struct Published {
    generation: TopologyGeneration,
    topology: Arc<Topology>,
    graph: Arc<DisplayGraph>,
}

/// The single owner of "what the displays are right now".
///
/// One instance per process. A second one would be a second answer to the same
/// question, and they would disagree the moment a display changed.
#[derive(Debug)]
pub struct SharedTopology {
    state: RwLock<Published>,
}

impl Default for SharedTopology {
    fn default() -> Self {
        Self::new()
    }
}

impl SharedTopology {
    /// Creates a publisher that has not yet observed anything.
    #[must_use]
    pub fn new() -> Self {
        let topology = Arc::new(Topology::new(Vec::new()));
        let graph = DisplayGraph::build(Arc::clone(&topology));

        Self {
            state: RwLock::new(Published {
                generation: TopologyGeneration::INITIAL,
                topology,
                graph,
            }),
        }
    }

    /// Publishes an arrangement, returning the transaction if anything changed.
    ///
    /// Returns `None` when the new arrangement is identical to the current one,
    /// and the generation does not advance. This is the common case, not an edge
    /// case: WD-6 treats platform events as hints and re-queries, and Windows
    /// emits `WM_DISPLAYCHANGE` for changes that leave the topology alone. A hint
    /// that turned out to be nothing must not look like a change, or every
    /// consumer reacts to a desktop that did not move.
    pub fn publish(&self, next: Topology) -> Option<TopologyTransaction> {
        // Read the current state and release the lock immediately: the work
        // below is the expensive part, and holding a lock across it would make
        // every reader wait for a diff computed on behalf of somebody else.
        let previous = {
            let guard = self.read();
            guard.clone()
        };

        let unchanged = previous.generation != TopologyGeneration::INITIAL
            && previous.topology.as_ref() == &next;
        if unchanged {
            return None;
        }

        let is_initial = previous.generation == TopologyGeneration::INITIAL;
        let diff = TopologyDiff::between(&previous.topology, &next);

        // An initial publication of nothing is still a publication: it is how a
        // consumer learns there are no displays, which it cannot infer from
        // silence.
        if !is_initial && diff.is_empty() {
            return None;
        }

        let current = Arc::new(next);
        let graph = DisplayGraph::build(Arc::clone(&current));
        let generation = previous.generation.next();

        let published = Published {
            generation,
            topology: Arc::clone(&current),
            graph: Arc::clone(&graph),
        };

        // The only mutation, and it is one assignment of one fully-built value.
        // A reader sees the whole of what came before or the whole of this.
        {
            let mut guard = self.write();
            *guard = published;
        }

        Some(TopologyTransaction {
            generation,
            previous: (!is_initial).then(|| Arc::clone(&previous.topology)),
            previous_graph: (!is_initial).then(|| Arc::clone(&previous.graph)),
            current,
            graph,
            diff,
        })
    }

    /// The current spatial index.
    ///
    /// Cloning the `Arc` under a read lock is the whole of the read path. The
    /// returned graph is immutable, so a caller can hold it across as much work
    /// as it likes and keep querying one consistent desktop.
    #[must_use]
    pub fn graph(&self) -> Arc<DisplayGraph> {
        Arc::clone(&self.read().graph)
    }

    /// The current arrangement.
    #[must_use]
    pub fn topology(&self) -> Arc<Topology> {
        Arc::clone(&self.read().topology)
    }

    /// How many publications have happened.
    #[must_use]
    pub fn generation(&self) -> TopologyGeneration {
        self.read().generation
    }

    /// Whether any enumeration has been published.
    #[must_use]
    pub fn has_observed(&self) -> bool {
        self.generation() != TopologyGeneration::INITIAL
    }

    /// Reads through a poisoned lock rather than propagating the panic.
    ///
    /// EM-1 forbids `unwrap`, and there is nothing to recover from anyway: the
    /// guarded value is always a fully-constructed `Published` swapped in one
    /// assignment, so a panic elsewhere cannot leave it torn. Refusing to serve
    /// the topology after an unrelated panic would take the desktop down with it.
    fn read(&self) -> std::sync::RwLockReadGuard<'_, Published> {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write(&self) -> std::sync::RwLockWriteGuard<'_, Published> {
        self.state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
