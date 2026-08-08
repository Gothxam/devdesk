//! The IPC error envelope (SYSTEM_ARCHITECTURE.md §7.5).
//!
//! ERR-2: every variant is actionable by the caller — retryable, fixable, or a
//! definite terminal state. A variant that tells the caller nothing is a design
//! defect, not a catch-all.

use serde::Serialize;
use specta::Type;

/// The platform a capability was unavailable on.
#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

/// A correlation identifier linking a shell-observed failure to a core-side span.
#[derive(Debug, Clone, Serialize, Type)]
pub struct TraceId(pub String);

/// The single error type every IPC command returns (IPC-3).
///
/// Returning a bare value is prohibited: it forecloses error evolution, and a
/// command that cannot report failure will report it some other way.
#[derive(Debug, Serialize, Type, thiserror::Error)]
#[serde(tag = "kind", content = "detail", rename_all = "kebab-case")]
pub enum IpcError {
    #[error("invalid argument: {field}")]
    InvalidArgument { field: String, expected: String },

    #[error("capability denied: {capability}")]
    CapabilityDenied { capability: String, subject: String },

    #[error("resource not found: {kind}/{id}")]
    NotFound { kind: String, id: String },

    #[error("precondition failed: {reason}")]
    PreconditionFailed { reason: String },

    #[error("operation not supported on {platform:?}: {feature}")]
    Unsupported { platform: Platform, feature: String },

    #[error("transient failure; retry after {retry_after_ms}ms")]
    Transient { retry_after_ms: u32, cause: String },

    /// ERR-1: deliberately opaque across the trust boundary.
    ///
    /// Carries no message, no path, and no backtrace — only a `trace_id` that
    /// correlates to the local log. Filesystem paths, usernames, hostnames, and
    /// backtraces must not cross into a webview (SEC-15).
    #[error("internal error: {trace_id:?}")]
    Internal { trace_id: TraceId },
}
