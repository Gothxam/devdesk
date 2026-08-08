//! Monitor arrangement identity.
//!
//! WD-4: layout is persisted **per topology fingerprint**. Docking, undocking,
//! and returning to a known arrangement restore the arrangement the user
//! configured for it — the laptop-plus-dock case, which is the common one and
//! not an edge case.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

use crate::monitor::{MonitorDescriptor, MonitorId};

/// A stable identifier for one complete monitor arrangement.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TopologyFingerprint(String);

impl TopologyFingerprint {
    /// The opaque fingerprint.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The complete set of attached displays.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Topology {
    monitors: Vec<MonitorDescriptor>,
}

impl Topology {
    /// Builds a topology from enumerated monitors.
    ///
    /// Monitors are sorted by identity, so enumeration order — which is not
    /// stable across reboots or docking events — cannot produce two fingerprints
    /// for one physical arrangement.
    #[must_use]
    pub fn new(mut monitors: Vec<MonitorDescriptor>) -> Self {
        monitors.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        Self { monitors }
    }

    /// The attached monitors, in stable identity order.
    #[must_use]
    pub fn monitors(&self) -> &[MonitorDescriptor] {
        &self.monitors
    }

    /// The primary monitor, if the platform reported one.
    #[must_use]
    pub fn primary(&self) -> Option<&MonitorDescriptor> {
        self.monitors.iter().find(|m| m.is_primary)
    }

    /// Finds a monitor by identity.
    #[must_use]
    pub fn find(&self, id: &MonitorId) -> Option<&MonitorDescriptor> {
        self.monitors.iter().find(|m| &m.id == id)
    }

    /// Whether the attached displays disagree about scale factor.
    ///
    /// Mixed DPI is the assumed case (`PS-4`). This exists so a caller can state
    /// plainly which configuration it is running on rather than infer it.
    #[must_use]
    pub fn is_mixed_dpi(&self) -> bool {
        let mut scales = self.monitors.iter().map(|m| m.scale_factor.get());
        match scales.next() {
            None => false,
            Some(first) => scales.any(|s| (s - first).abs() > f64::EPSILON),
        }
    }

    /// A stable fingerprint for this arrangement.
    ///
    /// Derived from monitor identity, geometry, and scale — **not** from
    /// enumeration order, display name, or refresh rate. Refresh is excluded on
    /// purpose: changing a refresh rate must not create a new arrangement and
    /// silently orphan the layout the user built (`AC-MON-1.4`).
    #[must_use]
    pub fn fingerprint(&self) -> TopologyFingerprint {
        let mut hasher = DefaultHasher::new();

        for monitor in &self.monitors {
            monitor.id.as_str().hash(&mut hasher);
            monitor.bounds.origin.x.hash(&mut hasher);
            monitor.bounds.origin.y.hash(&mut hasher);
            monitor.bounds.size.width.hash(&mut hasher);
            monitor.bounds.size.height.hash(&mut hasher);
            monitor.scale_factor.get().to_bits().hash(&mut hasher);
            monitor.is_primary.hash(&mut hasher);
        }

        TopologyFingerprint(format!("{:016x}", hasher.finish()))
    }
}
