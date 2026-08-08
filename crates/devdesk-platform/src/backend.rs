//! The seam every operating-system difference crosses.
//!
//! XP-1: all OS-specific behaviour is expressed through this trait, and
//! `#[cfg(target_os)]` outside this crate is prohibited (DR-6). The rule is
//! enforced by `scripts/lint-cfg-usage.mjs`, not by review.
//!
//! The trait is display-only today. That is deliberate: a method is added on the
//! day a caller needs it, because a stub returning `Unsupported` on every
//! platform is indistinguishable from a capability nobody implemented, and the
//! parity test in `tests` would certify it as correct.

use crate::display::{DisplayEventSink, RawMonitorInfo, SubscriptionId};
use crate::error::PlatformError;
use crate::feature::{PlatformFeature, Support};
use crate::platform::PlatformId;

/// The operating-system capabilities DevDesk depends on.
pub trait PlatformBackend: Send + Sync + 'static {
    /// Which platform and window system this backend is driving.
    fn id(&self) -> PlatformId;

    /// Whether a feature is available here, and with what caveat.
    ///
    /// XP-2: callers consult this before offering an action in the UI. Offering
    /// something that cannot succeed on the running platform is a defect, not a
    /// gracefully-handled edge case.
    fn supports(&self, feature: PlatformFeature) -> Support;

    /// Lists the attached displays.
    ///
    /// Returns raw records: what the system said, with the parts it did not say
    /// left absent rather than defaulted. A defaulted identity field is worse
    /// than a missing one, because the layer above cannot tell them apart and
    /// will assign a confidence the evidence does not support.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where enumeration is unavailable, and
    /// [`PlatformError::OsCall`] when the system refuses a call this backend
    /// expected to succeed.
    fn enumerate_monitors(&self) -> Result<Vec<RawMonitorInfo>, PlatformError>;

    /// Asks to be told when the display arrangement may have changed.
    ///
    /// WD-6: what arrives is a hint. The subscriber re-queries via
    /// [`PlatformBackend::enumerate_monitors`] for authoritative topology.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where the platform has no change
    /// notification, and [`PlatformError::OsCall`] when the subscription
    /// machinery cannot be established.
    fn subscribe_display_changes(
        &self,
        sink: DisplayEventSink,
    ) -> Result<SubscriptionId, PlatformError>;

    /// Ends a subscription.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where subscriptions do not exist. An
    /// unknown or already-ended id is **not** an error: teardown ordering is not
    /// something a caller should have to reason about during shutdown.
    fn unsubscribe_display_changes(&self, id: SubscriptionId) -> Result<(), PlatformError>;
}
