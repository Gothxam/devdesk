//! DevDesk host composition root.
//!
//! DR-7: this crate stays thin. Any function longer than roughly 30 lines, and
//! anything that could be unit-tested, belongs in a library crate under `crates/`
//! where it can be tested without the Tauri harness.

mod desktop_host;
mod reveal;
mod surface;

use std::sync::Arc;

use devdesk_core::desktop::{DesktopMode, RecoveryClock};
use devdesk_core::window::SurfaceHost;
use devdesk_display::{DisplayGraph, SharedTopology};
use devdesk_ipc::SHELL_WINDOW_LABEL;
use devdesk_platform::PlatformBackend;
use tauri::{App, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use serde::Deserialize;

use desktop_host::DesktopHost;

#[derive(Debug, Clone, Copy, Deserialize)]
struct InputRegionArg {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}


#[tauri::command]
fn desktop_set_edit_mode(app: tauri::AppHandle, enabled: bool) {
    if let Some(host) = app.try_state::<DesktopHost>() {
        host.set_edit_mode(enabled);
    }
}

#[tauri::command]
fn desktop_set_input_regions(
    app: tauri::AppHandle,
    regions: Vec<InputRegionArg>,
    is_edit_mode: bool,
) {
    if let Some(host) = app.try_state::<DesktopHost>() {
        let raw_rects: Vec<devdesk_platform::RawRect> = regions
            .into_iter()
            .map(|r| devdesk_platform::RawRect {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            })
            .collect();
        host.set_input_regions(&raw_rects, is_edit_mode);
    }
}

/// Builds and runs the DevDesk host.
///
/// # Errors
///
/// Returns [`tauri::Error`] if the Tauri runtime fails to initialise or the
/// application exits abnormally.
pub fn run() -> tauri::Result<()> {
    // The command registry is owned by devdesk-ipc, not assembled here. A command
    // registered outside that registry is invisible to versioning, to plugin
    // compatibility checks, and to the generated contract (B-3).
    let contract = devdesk_ipc::builder();

    tauri::Builder::default()
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            let cmd = invoke.message.command();
            if cmd == "desktop_set_edit_mode" {
                let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![desktop_set_edit_mode];
                handler(invoke);
                true
            } else if cmd == "desktop_set_input_regions" {
                let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![desktop_set_input_regions];
                handler(invoke);
                true
            } else {
                contract.invoke_handler()(invoke)
            }
        })



        .setup(|app| {
            // The window subsystem, wired to Tauri. Constructed here rather than
            // earlier because the sink needs an `AppHandle`, which does not
            // exist until setup.
            let host = SurfaceHost::new(surface::TauriSink::new(app.handle().clone()));

            // Startup enumeration: one authoritative topology publication so
            // `display_describe` answers from the real display subsystem.
            //
            // Hotplug is deliberately not wired here yet. The watcher, the WD-6
            // debounce, and the republish loop belong to the kernel's event
            // plumbing (Stage 3); until then the shell re-queries, and a
            // docking event is reflected on the next query rather than pushed.
            let backend = devdesk_platform::current_backend();
            let graph = publish_topology(&host, backend.as_ref());

            app.manage(host);

            start_desktop(app, backend.as_ref(), graph.as_deref())?;

            Ok(())
        })
        .run(tauri::generate_context!())
}


/// Enumerates displays once and publishes the result.
///
/// Returns the graph so the desktop host can plan against the same topology the
/// window subsystem observed, rather than enumerating a second time and possibly
/// getting a different answer.
fn publish_topology(
    host: &SurfaceHost,
    backend: &dyn PlatformBackend,
) -> Option<Arc<DisplayGraph>> {
    match devdesk_display::enumerate(backend) {
        Ok(topology) => {
            let displays = SharedTopology::new();
            let transaction = displays.publish(topology)?;

            // Cannot be stale: it is the first and only publication.
            let _ = host.observe(&transaction);

            Some(transaction.graph().clone())
        }
        Err(error) => {
            // A machine whose displays cannot be enumerated still gets a
            // desktop — the shell falls back to a single synthetic display and
            // says so. Refusing to start would turn a driver quirk into an
            // unusable application (EM-3).
            eprintln!("devdesk: display enumeration failed: {error}");
            None
        }
    }
}

/// Puts the desktop where it belongs: on the desktop, or in a window.
///
/// `ADR-0005` `DH-7`: window mode is the floor, so this never fails the startup.
/// Every path that ends in a window says why (`XP-3`).
fn start_desktop(
    app: &App,
    backend: &dyn PlatformBackend,
    graph: Option<&DisplayGraph>,
) -> tauri::Result<()> {
    let desktop = DesktopHost::new(app.handle().clone());

    let mode = match graph {
        Some(graph) => desktop.apply(backend, graph),
        None => DesktopMode::Windowed {
            reason: "no display topology could be enumerated".to_owned(),
        },
    };

    app.manage(desktop);

    match &mode {
        DesktopMode::Attached { monitors } => {
            // DH-10: notice when Explorer restarts. Failing to subscribe is not
            // fatal — a desktop that cannot detect a restart still works until
            // Explorer restarts, and refusing to start would be worse.
            if let Err(error) =
                desktop_host::watch_shell_restarts(backend, app.handle().clone(), monotonic_clock())
            {
                eprintln!("devdesk: shell restart detection unavailable: {error}");
            }

            eprintln!("devdesk: desktop mode on {monitors} monitor(s)");
            Ok(())
        }

        DesktopMode::Windowed { reason } => {
            eprintln!("devdesk: window mode — {reason}");
            create_shell_window(&app.handle().clone())
        }
    }
}

/// The shell's own window, for window mode (`DH-7`).
///
/// Created hidden, with the same AC-FRE-1.1 discipline surfaces get: the shell
/// flashing white on launch is the same defect at desktop size. The reveal hook
/// shows it once its document has loaded.
///
/// Already having one is success, not a conflict. This is called both at startup
/// and after desktop attachment is abandoned, and the second call must not fail
/// on a label the first one took — `DH-7` promises a window, not a new one.
pub(crate) fn create_shell_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(SHELL_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    reveal::when_content_loads_plain(
        WebviewWindowBuilder::new(app, SHELL_WINDOW_LABEL, WebviewUrl::default())
            .title("DevDesk")
            .inner_size(1280.0, 800.0)
            .visible(false),
    )
    .build()?;

    Ok(())
}

/// A monotonic reading for the recovery debounce.
///
/// `Instant` rather than `SystemTime`: a wall clock that steps backwards over an
/// NTP correction would make the debounce window either never close or close
/// instantly. The origin is process start, which is all the debounce needs.
fn monotonic_clock() -> desktop_host::Clock {
    let origin = std::time::Instant::now();

    Arc::new(move || RecoveryClock(u64::try_from(origin.elapsed().as_millis()).unwrap_or(u64::MAX)))
}
