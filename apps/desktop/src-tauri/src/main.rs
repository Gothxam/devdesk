// LC-3: windows are created hidden and shown only when their first frame is
// ready. Showing an unpainted window produces a visible white flash.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> tauri::Result<()> {
    devdesk_app_lib::run()
}
