//! What can go wrong at the operating-system boundary.
//!
//! This error never crosses into a webview. `devdesk-ipc` owns the envelope that
//! does (`IpcError`), and it is deliberately narrower: `OsCall` carries a system
//! error code and `Malformed` carries a device string, neither of which belongs
//! on the far side of the trust boundary (SEC-15, ERR-1).

use crate::feature::PlatformFeature;
use crate::platform::PlatformId;

/// A failure at the platform boundary.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlatformError {
    /// XP-3: the operation is not available here, and the reason says why.
    ///
    /// Distinct from a failure. Nothing went wrong; the capability is absent,
    /// and the caller should have asked `supports()` first.
    #[error("{feature} is unsupported on {platform}: {reason}")]
    Unsupported {
        platform: PlatformId,
        feature: PlatformFeature,
        reason: &'static str,
    },

    /// A system call the backend expected to succeed did not.
    #[error("{call} failed with system error {code}")]
    OsCall { call: &'static str, code: u32 },

    /// The system answered in a shape this backend cannot interpret.
    ///
    /// Separate from `OsCall` because the remedy differs: an `OsCall` is
    /// usually transient or permission-related, while `Malformed` means the
    /// backend's model of the platform is wrong and needs code.
    #[error("{what} could not be interpreted: {detail}")]
    Malformed { what: &'static str, detail: String },
}
