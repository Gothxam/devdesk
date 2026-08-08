//! The IPC contract: the seam between the trusted core and the semi-trusted webview.
//!
//! This crate owns the command registry, argument validation, the error envelope,
//! contract version negotiation, and TypeScript codegen. It owns no business
//! logic — commands are thin adapters onto `devdesk-core` (RS-8).
//!
//! The TypeScript half of this contract is **generated, never hand-written**
//! (GEN-1, DD-003). A hand-maintained mirror drifts silently, and silent drift at
//! a trust boundary is a security problem rather than a typing inconvenience.

pub mod error;

use serde::Serialize;
use specta::Type;

pub use error::{IpcError, Platform, TraceId};

/// The IPC contract version, evolving independently of the application version
/// (§7.3, BR-5).
///
/// A plugin declares the range it was built against; the core negotiates or
/// rejects with a precise diagnostic. It never loads partially.
pub const CONTRACT_VERSION: &str = "0.1.0";

/// The result of contract version negotiation.
#[derive(Debug, Clone, Serialize, Type)]
pub struct ContractInfo {
    /// The contract version this core offers.
    pub version: String,
    /// The application version, which moves independently (Appendix B).
    pub app_version: String,
}

/// Returns the contract and application versions.
///
/// This is the first command in the registry and exists to prove the pipeline
/// end to end: a Rust signature becomes a generated TypeScript type with no
/// hand-written mirror anywhere.
///
/// # Errors
///
/// Currently infallible, but returns [`IpcError`] because IPC-3 requires every
/// command to return `Result` — a command that cannot fail today acquires the
/// ability to fail the moment it does anything real, and widening the return
/// type later is a breaking contract change.
/// Commands are not `pub`: `#[tauri::command]` generates helper macros named after
/// the function, and exporting them collides at the module boundary. They are
/// reachable only through [`builder`], which is the registry's single entry point.
#[tauri::command]
#[specta::specta]
fn contract_describe() -> Result<ContractInfo, IpcError> {
    Ok(ContractInfo {
        version: CONTRACT_VERSION.to_owned(),
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
    })
}

/// Builds the command registry.
///
/// Every command reachable from the shell is registered here. A command that is
/// not in this registry does not exist to the contract, and B-12 requires every
/// user-reachable action to be expressible as one.
#[must_use]
pub fn builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![contract_describe])
}
