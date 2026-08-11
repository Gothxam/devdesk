//! DevDesk host composition root.
//!
//! DR-7: this crate stays thin. Any function longer than roughly 30 lines, and
//! anything that could be unit-tested, belongs in a library crate under `crates/`
//! where it can be tested without the Tauri harness.

mod surface;

use devdesk_core::window::SurfaceHost;
use devdesk_display::SharedTopology;
use devdesk_ipc::SHELL_WINDOW_LABEL;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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
        .invoke_handler(contract.invoke_handler())
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
            match devdesk_display::enumerate(backend.as_ref()) {
                Ok(topology) => {
                    let displays = SharedTopology::new();
                    if let Some(transaction) = displays.publish(topology) {
                        // Cannot be stale: it is the first and only publication.
                        let _ = host.observe(&transaction);
                    }
                }
                Err(error) => {
                    // A machine whose displays cannot be enumerated still gets a
                    // desktop — the shell falls back to a single synthetic
                    // display and says so. Refusing to start would turn a
                    // driver quirk into an unusable application (EM-3).
                    eprintln!("devdesk: display enumeration failed: {error}");
                }
            }

            app.manage(host);

            // The shell's own window, created hidden. The same AC-FRE-1.1
            // discipline surfaces get: the shell flashing white on launch is
            // the same defect at desktop size. `shell_report_first_frame`
            // reveals it once the webview has painted.
            //
            // A plain window, not fullscreen: the composed desktop is a
            // prototype checkpoint, and a misbehaving fullscreen window is much
            // harder to dismiss than a misbehaving windowed one.
            WebviewWindowBuilder::new(app, SHELL_WINDOW_LABEL, WebviewUrl::default())
                .title("DevDesk")
                .inner_size(1280.0, 800.0)
                .visible(false)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
}
