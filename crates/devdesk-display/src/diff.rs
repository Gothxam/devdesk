//! What changed between two arrangements.
//!
//! Computed once, by the publisher, and carried in the transaction. The
//! alternative — every consumer comparing the topology it was handed against the
//! one it remembers — means every consumer implements this, and each one gets a
//! slightly different answer to "did that display move or is it a new display".
//!
//! Displays are paired by identity, not by position in the list. Pairing is
//! attempted first on the derived key, then on a **conclusive** identity match
//! for anything left over (see [`crate::identity`]). That second pass is what
//! stops a display whose serial became unreadable between enumerations from
//! presenting as one removal and one addition, which would tear down its
//! surfaces and rebuild them for a display that never left.
//!
//! A pairing that is merely probable is deliberately *not* used: `Probable` is
//! also what two identical panels swapped between sessions look like, and the
//! safe reading of that is a removal and an addition rather than a silent
//! reattachment (`AC-DAT-1.1`).

use serde::{Deserialize, Serialize};

use crate::identity::{resolve, MonitorId, MonitorIdentity};
use crate::monitor::MonitorDescriptor;
use crate::topology::Topology;

/// The difference between two arrangements.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyDiff {
    added: Vec<MonitorId>,
    removed: Vec<MonitorId>,
    moved: Vec<MonitorId>,
    resized: Vec<MonitorId>,
    rescaled: Vec<MonitorId>,
    work_area_changed: Vec<MonitorId>,
    primary_changed: bool,
}

impl TopologyDiff {
    /// Computes the difference from `previous` to `current`.
    #[must_use]
    pub fn between(previous: &Topology, current: &Topology) -> Self {
        let mut diff = Self::default();

        let mut current_paired = vec![false; current.monitors().len()];
        let mut unpaired_previous: Vec<&MonitorDescriptor> = Vec::new();

        // Pass one: the derived key. This covers everything on a normal
        // enumeration, where nothing about how the displays report themselves
        // has changed.
        for monitor in previous.monitors() {
            match current
                .monitors()
                .iter()
                .position(|other| other.id() == monitor.id())
            {
                Some(index) => {
                    current_paired[index] = true;
                    diff.compare(monitor, &current.monitors()[index]);
                }
                None => unpaired_previous.push(monitor),
            }
        }

        // Pass two: conclusive identity for the leftovers.
        let unpaired_current: Vec<usize> = current_paired
            .iter()
            .enumerate()
            .filter_map(|(index, paired)| (!paired).then_some(index))
            .collect();

        let candidates: Vec<MonitorIdentity> = unpaired_current
            .iter()
            .filter_map(|index| current.monitors().get(*index))
            .map(|monitor| monitor.identity.clone())
            .collect();

        for monitor in unpaired_previous {
            let matched = resolve(&candidates, &monitor.identity)
                .filter(|found| found.confidence.is_conclusive())
                .and_then(|found| unpaired_current.get(found.index).copied())
                .filter(|index| !current_paired[*index]);

            match matched {
                Some(index) => {
                    current_paired[index] = true;
                    diff.compare(monitor, &current.monitors()[index]);
                }
                None => diff.removed.push(monitor.id().clone()),
            }
        }

        for (index, paired) in current_paired.iter().enumerate() {
            if !paired {
                if let Some(monitor) = current.monitors().get(index) {
                    diff.added.push(monitor.id().clone());
                }
            }
        }

        diff.primary_changed = previous.primary().map(MonitorDescriptor::id)
            != current.primary().map(MonitorDescriptor::id);

        diff
    }

    /// Records what differs between one display's two observations.
    fn compare(&mut self, previous: &MonitorDescriptor, current: &MonitorDescriptor) {
        let id = current.id();

        if previous.bounds.origin != current.bounds.origin {
            self.moved.push(id.clone());
        }
        if previous.bounds.size != current.bounds.size {
            self.resized.push(id.clone());
        }
        // Bit equality is sound here: `ScaleFactor` rejects NaN at construction,
        // so the one case where bit equality diverges from value equality cannot
        // arise.
        if previous.scale_factor.get().to_bits() != current.scale_factor.get().to_bits() {
            self.rescaled.push(id.clone());
        }
        if previous.work_area != current.work_area {
            self.work_area_changed.push(id.clone());
        }
    }

    /// Displays present now that were not present before.
    #[must_use]
    pub fn added(&self) -> &[MonitorId] {
        &self.added
    }

    /// Displays that were present before and are not now.
    #[must_use]
    pub fn removed(&self) -> &[MonitorId] {
        &self.removed
    }

    /// Displays whose origin changed.
    #[must_use]
    pub fn moved(&self) -> &[MonitorId] {
        &self.moved
    }

    /// Displays whose resolution changed.
    #[must_use]
    pub fn resized(&self) -> &[MonitorId] {
        &self.resized
    }

    /// Displays whose scale factor changed.
    #[must_use]
    pub fn rescaled(&self) -> &[MonitorId] {
        &self.rescaled
    }

    /// Displays whose usable area changed without their bounds changing.
    ///
    /// A taskbar moving from the bottom edge to the left does exactly this, and
    /// a consumer anchoring to the work area has to reflow for it even though
    /// nothing about the hardware changed.
    #[must_use]
    pub fn work_area_changed(&self) -> &[MonitorId] {
        &self.work_area_changed
    }

    /// Whether a different display is now primary.
    #[must_use]
    pub const fn primary_changed(&self) -> bool {
        self.primary_changed
    }

    /// Whether anything changed at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.removed.is_empty()
            && self.moved.is_empty()
            && self.resized.is_empty()
            && self.rescaled.is_empty()
            && self.work_area_changed.is_empty()
            && !self.primary_changed
    }

    /// Whether the set of attached displays changed, as opposed to their geometry.
    ///
    /// The distinction decides how much work a consumer does: a display arriving
    /// or leaving means arrangements are rebound, while a display moving means
    /// existing surfaces are repositioned.
    #[must_use]
    pub fn membership_changed(&self) -> bool {
        !self.added.is_empty() || !self.removed.is_empty()
    }
}
