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

/// A rectangle in logical pixels, as the shell composes in.
#[derive(Debug, Clone, Serialize, Type)]
pub struct LogicalRectInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One attached display, as the shell needs it.
///
/// **Logical pixels**, because the webview composes in CSS pixels and handing it
/// physical ones would push the `WD-2` conversion — which requires a monitor —
/// across the boundary to the side that does not hold one.
///
/// The identity is the opaque monitor key. It is hardware-identifying (device
/// path or serial), and it crosses here because the shell is Trust Zone 1
/// (§18.2) and must associate surfaces with displays. **Exposing it to plugins
/// is a separate decision that has not been taken** — the M3 host API must not
/// forward this struct as-is (`SEC-15`, ADR-0004 `T-10`).
#[derive(Debug, Clone, Serialize, Type)]
pub struct DisplayInfo {
    pub id: String,
    /// Human-readable, for matching to hardware (`AC-MON-8.3`). Never identity.
    pub name: String,
    pub is_primary: bool,
    pub scale_factor: f64,
    /// The placeable area, excluding taskbars (work area, not bounds).
    pub work_area: LogicalRectInfo,
}

/// The attached displays.
#[derive(Debug, Clone, Serialize, Type)]
pub struct DisplayTopologyInfo {
    /// In stable identity order. Empty means no display is attached — a real
    /// state, not an error.
    pub monitors: Vec<DisplayInfo>,
}

/// Describes the current display topology.
///
/// A **snapshot**, deliberately: no generation crosses the boundary (`TP-14` —
/// process-local, and the webview reloads independently of the process), and no
/// subscription exists yet. Change *push* to the shell arrives with the event
/// bus in Stage 3 of the kernel work; until then the shell re-queries.
///
/// # Errors
///
/// [`IpcError::Internal`] if enumeration has not happened yet — the window
/// subsystem observes topology at startup, so this is a startup-ordering bug
/// rather than a user-visible state.
#[tauri::command]
#[specta::specta]
fn display_describe(host: tauri::State<'_, SurfaceHost>) -> Result<DisplayTopologyInfo, IpcError> {
    let monitors = host.with_manager(|manager| {
        manager
            .graph()
            .monitors()
            .iter()
            .map(|monitor| {
                let area = monitor.logical_work_area();
                DisplayInfo {
                    id: monitor.id().to_string(),
                    name: monitor.name.clone(),
                    is_primary: monitor.is_primary,
                    scale_factor: monitor.scale_factor.get(),
                    work_area: LogicalRectInfo {
                        x: area.origin.x,
                        y: area.origin.y,
                        width: area.size.width,
                        height: area.size.height,
                    },
                }
            })
            .collect()
    });

    Ok(DisplayTopologyInfo { monitors })
}

/// The label of the shell's own window.
///
/// One place, because the creation site in `devdesk-app` and the reveal below
/// must agree, and a string repeated in two crates is how they stop agreeing.
pub const SHELL_WINDOW_LABEL: &str = "main";

/// Reveals the shell window after its first paint.
///
/// The shell window is created **hidden** — the same `AC-FRE-1.1` discipline
/// surfaces get, because the shell flashing white on launch is the same defect
/// at desktop size. The shell calls this once its first frame has painted, and
/// being early is impossible: the window exists before the webview can run.
///
/// # Errors
///
/// [`IpcError::NotFound`] if the shell window does not exist, which is a
/// composition-root bug, and [`IpcError::Internal`] if the windowing system
/// refused to show it.
#[tauri::command]
#[specta::specta]
fn shell_report_first_frame(app: tauri::AppHandle) -> Result<(), IpcError> {
    use tauri::Manager;

    let window = app
        .get_webview_window(SHELL_WINDOW_LABEL)
        .ok_or_else(|| IpcError::NotFound {
            kind: "window".to_owned(),
            id: SHELL_WINDOW_LABEL.to_owned(),
        })?;

    window.show().map_err(|_| IpcError::Internal {
        trace_id: next_trace_id(),
    })
}

/// Where a surface is.
///
/// The monitor is absent when no display is attached — a closed lid with
/// nothing plugged in. A real state, and the shell renders differently for it
/// rather than guessing.
#[derive(Debug, Clone, Serialize, Type)]
pub struct SurfacePlacement {
    pub surface_id: String,
    pub monitor_id: Option<String>,
}

/// Registers a surface and creates its window, hidden.
///
/// The identity is supplied by the caller and **is the widget instance's
/// identity**. Both have to survive a restart and both name the same thing, so
/// deriving one from the other would mean maintaining a mapping that can only
/// ever be wrong. The window is created hidden regardless; nothing here can
/// make anything visible (`AC-FRE-1.1`).
///
/// # Errors
///
/// [`IpcError::InvalidArgument`] for an empty identity,
/// [`IpcError::PreconditionFailed`] if the identity is already registered, and
/// [`IpcError::Internal`] if the windowing system refused to create the window.
#[tauri::command]
#[specta::specta]
fn surface_register(
    host: tauri::State<'_, SurfaceHost>,
    surface_id: String,
) -> Result<SurfacePlacement, IpcError> {
    let surface = SurfaceId::new(surface_id).ok_or_else(|| IpcError::InvalidArgument {
        field: "surface_id".to_owned(),
        expected: "a non-empty surface identity".to_owned(),
    })?;

    host.register(surface.clone())
        .map_err(|error| match error {
            HostError::Window(WindowError::Surface(SurfaceError::AlreadyRegistered {
                surface,
            })) => IpcError::PreconditionFailed {
                reason: format!("surface {surface} is already registered"),
            },
            _ => IpcError::Internal {
                trace_id: next_trace_id(),
            },
        })?;

    let monitor_id = host.with_manager(|manager| {
        manager
            .surfaces()
            .get(&surface)
            .and_then(|record| record.monitor().map(ToString::to_string))
    });

    Ok(SurfacePlacement {
        surface_id: surface.to_string(),
        monitor_id,
    })
}

/// Removes a surface and destroys its window.
///
/// # Errors
///
/// [`IpcError::NotFound`] for an unknown surface. A refusal from the windowing
/// system is **not** reported as a failure to the caller: the surface is gone
/// either way, and telling the shell otherwise would have it believe a widget it
/// no longer owns is still placed.
#[tauri::command]
#[specta::specta]
fn surface_release(
    host: tauri::State<'_, SurfaceHost>,
    surface_id: String,
) -> Result<(), IpcError> {
    let surface = SurfaceId::new(surface_id).ok_or_else(|| IpcError::InvalidArgument {
        field: "surface_id".to_owned(),
        expected: "a non-empty surface identity".to_owned(),
    })?;

    match host.remove(&surface) {
        Ok(_) | Err(HostError::Sink { .. }) => Ok(()),
        Err(HostError::Window(WindowError::Surface(SurfaceError::Unknown { surface }))) => {
            Err(IpcError::NotFound {
                kind: "surface".to_owned(),
                id: surface.to_string(),
            })
        }
        Err(_) => Err(IpcError::Internal {
            trace_id: next_trace_id(),
        }),
    }
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
        display_describe,
        shell_report_first_frame,
        surface_register,
        surface_release,
        surface_report_first_frame
    ])
}
