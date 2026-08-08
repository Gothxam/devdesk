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

use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use specta::Type;

use devdesk_core::window::{HostError, SurfaceError, SurfaceHost, SurfaceId, WindowError};

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

/// Reports that a surface has painted its first frame.
///
/// The shell calls this once, after its first paint. It is the entire input to
/// the reveal sequence from outside the core: nothing else makes a surface
/// visible, so `AC-FRE-1.1` reduces to "the shell tells the truth about when it
/// painted", and being late costs a delay while being early is refused by the
/// state machine.
///
/// The surface identity crosses as a string rather than a branded type. The core
/// validates it (`SurfaceId::new`), and keeping `specta` out of `devdesk-core`
/// is worth a stringly-typed argument at one boundary. Revisit when a second
/// surface command exists.
///
/// # Errors
///
/// [`IpcError::InvalidArgument`] for an empty identity, [`IpcError::NotFound`]
/// for an unknown surface, [`IpcError::PreconditionFailed`] when no window has
/// been created for it yet, and [`IpcError::Internal`] when the windowing system
/// refused — deliberately opaque across the trust boundary (ERR-1, SEC-15),
/// because the underlying message can carry a filesystem path.
#[tauri::command]
#[specta::specta]
fn surface_report_first_frame(
    host: tauri::State<'_, SurfaceHost>,
    surface_id: String,
) -> Result<(), IpcError> {
    let surface = SurfaceId::new(surface_id).ok_or_else(|| IpcError::InvalidArgument {
        field: "surface_id".to_owned(),
        expected: "a non-empty surface identity".to_owned(),
    })?;

    host.report_first_frame(&surface)
        .map_err(|error| match error {
            HostError::Window(WindowError::Surface(SurfaceError::Unknown { surface })) => {
                IpcError::NotFound {
                    kind: "surface".to_owned(),
                    id: surface.to_string(),
                }
            }
            HostError::Window(WindowError::Reveal(reveal)) => IpcError::PreconditionFailed {
                reason: reveal.to_string(),
            },
            _ => IpcError::Internal {
                trace_id: next_trace_id(),
            },
        })?;

    Ok(())
}

/// A correlation id for a failure whose detail must not cross the boundary.
///
/// Process-local and monotonic. It correlates to a core-side log line once
/// `devdesk-telemetry` carries one; until then it at least distinguishes two
/// reports of "internal error" from one report seen twice.
fn next_trace_id() -> TraceId {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    TraceId(format!("ipc-{}", NEXT.fetch_add(1, Ordering::Relaxed)))
}

/// Builds the command registry.
///
/// Every command reachable from the shell is registered here. A command that is
/// not in this registry does not exist to the contract, and B-12 requires every
/// user-reachable action to be expressible as one.
#[must_use]
pub fn builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        contract_describe,
        surface_report_first_frame
    ])
}
