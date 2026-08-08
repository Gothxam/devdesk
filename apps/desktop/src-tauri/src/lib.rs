//! DevDesk host composition root.
//!
//! DR-7: this crate stays thin. Any function longer than roughly 30 lines, and
//! anything that could be unit-tested, belongs in a library crate under `crates/`
//! where it can be tested without the Tauri harness.

mod surface;

use devdesk_core::window::SurfaceHost;
use tauri::Manager;

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
            //
            // No surface is created at startup. The machinery to create one
            // hidden and reveal it on its first frame is in place; what should
            // be on the desktop at first run is an arrangement decision that
            // arrives with the layout actor.
            app.manage(SurfaceHost::new(surface::TauriSink::new(
                app.handle().clone(),
            )));
            Ok(())
        })
        .run(tauri::generate_context!())
}
