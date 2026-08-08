//! What can go wrong turning a platform record into a display.

use devdesk_platform::PlatformError;

/// A failure in the display layer.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DisplayError {
    /// The platform could not answer.
    #[error("the platform could not describe the attached displays: {0}")]
    Platform(#[from] PlatformError),

    /// A display reported geometry or scale that cannot be used.
    ///
    /// Named per display rather than reported as one failure for the
    /// enumeration: a caller can then say which display is unusable, and a
    /// single bad record does not have to look like a broken machine.
    #[error("display {device} reported unusable {field}: {detail}")]
    UnusableDisplay {
        device: String,
        field: &'static str,
        detail: String,
    },
}
