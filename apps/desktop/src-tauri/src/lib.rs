//! DevDesk host composition root.
//!
//! DR-7: this crate stays thin. Any function longer than roughly 30 lines, and
//! anything that could be unit-tested, belongs in a library crate under `crates/`
//! where it can be tested without the Tauri harness.

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
        .run(tauri::generate_context!())
}
