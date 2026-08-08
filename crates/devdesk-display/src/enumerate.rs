//! Turning what the platform reported into a topology.
//!
//! This is the whole of the `PlatformBackend → DisplayTopology` step. It is a
//! free function over a `&dyn PlatformBackend` rather than a type holding one,
//! because it has no state: everything it produces is derived from one
//! enumeration, and a cached copy of the previous one is exactly the stale
//! state `TopologyTransaction` exists to eliminate.

use devdesk_platform::{PlatformBackend, PlatformFeature};

use crate::error::DisplayError;
use crate::monitor::MonitorDescriptor;
use crate::topology::Topology;

/// Reads the current arrangement from a platform backend.
///
/// # Errors
///
/// [`DisplayError::Platform`] when the backend cannot enumerate, and
/// [`DisplayError::UnusableDisplay`] when a display reports geometry no surface
/// could be placed on.
pub fn enumerate(backend: &dyn PlatformBackend) -> Result<Topology, DisplayError> {
    let raw = backend.enumerate_monitors()?;

    let mut monitors = Vec::with_capacity(raw.len());
    for record in &raw {
        monitors.push(MonitorDescriptor::from_raw(record)?);
    }

    Ok(Topology::new(monitors))
}

/// Whether this backend can identify displays well enough to bind layouts to them.
///
/// XP-2: asked before offering the feature, not discovered when it fails. A
/// backend without device paths or serials can still run a desktop — it just
/// cannot promise that the arrangement comes back after a docking event, and the
/// user is better told that than shown it.
#[must_use]
pub fn supports_stable_identity(backend: &dyn PlatformBackend) -> bool {
    backend
        .supports(PlatformFeature::MonitorDevicePath)
        .is_available()
        || backend
            .supports(PlatformFeature::MonitorSerial)
            .is_available()
}
