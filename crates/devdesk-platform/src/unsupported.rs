//! The backend for a platform DevDesk does not implement yet.
//!
//! It exists so that "unimplemented" is a *value* rather than a compile error or
//! a panic. `QA-9` requires a feature added on Windows to compile on macOS and
//! Linux with unsupported paths returning a typed `Unsupported` — this is the
//! type that makes that hold without a single `todo!()` in the tree.
//!
//! Every method here answers with the same reason string the backend was built
//! with, so a caller on an unimplemented platform gets "the macOS backend lands
//! in M4" rather than an empty list it will mistake for a machine with no
//! displays attached.

use crate::backend::PlatformBackend;
use crate::display::{DisplayEventSink, RawMonitorInfo, SubscriptionId};
use crate::error::PlatformError;
use crate::feature::{PlatformFeature, Support};
use crate::platform::PlatformId;

/// A backend that supports nothing and says why.
#[derive(Debug, Clone, Copy)]
pub struct UnsupportedBackend {
    id: PlatformId,
    reason: &'static str,
}

impl UnsupportedBackend {
    /// Creates a backend that reports `reason` for every capability.
    #[must_use]
    pub const fn new(id: PlatformId, reason: &'static str) -> Self {
        Self { id, reason }
    }

    fn unsupported(self, feature: PlatformFeature) -> PlatformError {
        PlatformError::Unsupported {
            platform: self.id,
            feature,
            reason: self.reason,
        }
    }
}

impl PlatformBackend for UnsupportedBackend {
    fn id(&self) -> PlatformId {
        self.id
    }

    fn supports(&self, _feature: PlatformFeature) -> Support {
        Support::Unsupported {
            reason: self.reason,
        }
    }

    fn enumerate_monitors(&self) -> Result<Vec<RawMonitorInfo>, PlatformError> {
        // Not `Ok(vec![])`. An empty list is a machine with no displays, which is
        // a state a caller may legitimately handle; this is a machine whose
        // displays cannot be seen, which is not (AP-15).
        Err(self.unsupported(PlatformFeature::MonitorEnumeration))
    }

    fn subscribe_display_changes(
        &self,
        _sink: DisplayEventSink,
    ) -> Result<SubscriptionId, PlatformError> {
        Err(self.unsupported(PlatformFeature::DisplayChangeEvents))
    }

    fn unsubscribe_display_changes(&self, _id: SubscriptionId) -> Result<(), PlatformError> {
        // Teardown of a subscription that was never established succeeds. The
        // failure was at `subscribe`, and reporting it twice makes shutdown
        // paths carry error handling for a failure they did not cause.
        Ok(())
    }
}
