//! DevDesk host composition root.
//!
//! DR-7: this crate stays thin. Any function longer than roughly 30 lines, and
//! anything that could be unit-tested, belongs in a library crate under `crates/`
//! where it can be tested without the Tauri harness.

mod desktop_host;
mod reveal;
mod surface;

use std::sync::Arc;

use devdesk_core::desktop::{DesktopMode, InteractionMode, InteractionSource, RecoveryClock};
use devdesk_core::window::SurfaceHost;
use devdesk_display::{DisplayGraph, SharedTopology};
use devdesk_ipc::SHELL_WINDOW_LABEL;
use devdesk_platform::{Hotkey, PlatformBackend};
use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use desktop_host::DesktopHost;

/// Asks the desktop to enter or leave the state the user can edit it in.
///
/// The shell can reach this only when the desktop is **already** interactive —
/// in window mode, in a browser, or once the hotkey has opened the door. It is
/// therefore not the way in, and must not be treated as one: it exists so the
/// in-page button and context menu can turn editing *off*, and so a reloaded
/// webview can re-assert a state it was told about.
#[tauri::command]
fn desktop_set_edit_mode(app: AppHandle, enabled: bool) {
    let requested = InteractionMode::from_editing(enabled);
    eprintln!("devdesk: [IPC] desktop_set_edit_mode enabled={enabled} -> {requested}");

    let Some(host) = app.try_state::<DesktopHost>() else {
        // Window mode never manages a `DesktopHost`, and the shell running there
        // has nothing to toggle: an ordinary window is already interactive.
        eprintln!("devdesk: [IPC] no desktop host in this mode; nothing to toggle");
        return;
    };

    host.set_interaction(requested, InteractionSource::Shell);
    publish_interaction(&app, host.interaction());
}

/// Reports the mode the desktop is actually in.
///
/// The shell calls this on mount instead of pushing its own initial state down.
/// The old direction was the bug: the webview asserted `false` on every load,
/// so a reload silently left edit mode, and the assertion raced the hotkey.
#[tauri::command]
fn desktop_interaction_state(app: AppHandle) -> bool {
    let editing = app
        .try_state::<DesktopHost>()
        .is_some_and(|host| host.interaction().is_editing());

    eprintln!("devdesk: [IPC] desktop_interaction_state -> editing={editing}");
    editing
}

/// The event the shell listens on for mode changes it did not initiate.
///
/// The hotkey is exactly that case: it is handled entirely in the native layer,
/// and without this the UI would still be showing "Edit Layout" over a desktop
/// that had become editable.
const INTERACTION_EVENT: &str = "devdesk://interaction";

/// Tells every window what mode the desktop is in.
pub(crate) fn publish_interaction(app: &AppHandle, mode: InteractionMode) {
    if let Err(error) = app.emit(INTERACTION_EVENT, mode.is_editing()) {
        eprintln!("devdesk: [EDIT] could not publish interaction state: {error}");
    }
}

/// The combinations that open the door, in order of preference.
///
/// One of these has to be system-wide. Every in-page trigger — the button, the
/// context menu, `Ctrl+E` — lives inside a window that in ambient mode is
/// click-through and sits beneath Explorer's icon layer, so none of them can
/// fire from the state they are meant to leave. `Ctrl+E` stays the primary
/// shortcut *inside* the desktop; this is only how the desktop is reached.
///
/// Not `Ctrl+E` itself: registered system-wide it would be taken away from every
/// other application on the machine.
///
/// **A list, not one.** `RegisterHotKey` refuses a combination another process
/// already holds (`ERROR_HOTKEY_ALREADY_REGISTERED`, 1409), so a single
/// hard-coded key means one collision leaves a desktop nobody can edit —
/// observed, when a DevDesk from an earlier run was still holding it.
const EDIT_HOTKEYS: [Hotkey; 3] = [
    Hotkey::ctrl_shift(b'D' as u16),
    Hotkey::ctrl_alt(b'D' as u16),
    // `VK_OEM_3`, the backtick key. Rarely claimed, and reachable without
    // looking down — which is what a fallback has to be.
    Hotkey::ctrl_shift(0xC0),
];

/// The commands this crate answers rather than the generated contract.
///
/// Listed once so the router and the handler cannot drift: a command added to
/// `generate_handler!` and forgotten here is never reached, which presents as a
/// button that does nothing.
const HOST_COMMANDS: [&str; 2] = ["desktop_set_edit_mode", "desktop_interaction_state"];

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
        // Two registries. The contract's is generated from Rust signatures and
        // owns the versioned, plugin-facing surface (`B-3`); these two are host
        // controls that have no place in it — a window's z-order band is not
        // something a plugin negotiates.
        //
        // Dispatched by exact name. `Invoke` is not `Clone`, so it cannot be
        // offered to both; and an exact match is what keeps the routing
        // readable — the previous `ends_with` would have claimed any command
        // whose name merely finished the same way.
        .invoke_handler(move |invoke| {
            if HOST_COMMANDS.contains(&invoke.message.command()) {
                let local: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool =
                    tauri::generate_handler![desktop_set_edit_mode, desktop_interaction_state];

                return local(invoke);
            }

            contract.invoke_handler()(invoke)
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

            // The only input path into a window that is click-through and behind
            // the shell. Without it nothing can enter edit mode at all, so a
            // failure here is reported loudly rather than noted in passing.
            match desktop_host::watch_edit_hotkey(backend, app.handle().clone(), &EDIT_HOTKEYS) {
                Ok(hotkey) => {
                    eprintln!(
                        "devdesk: press {hotkey} to edit the desktop (then Ctrl+E or Escape)"
                    );
                }
                Err(error) => eprintln!(
                    "devdesk: no edit shortcut could be registered ({error}); the desktop \
                     renders but cannot be edited — every candidate is held by another \
                     application, which includes a DevDesk already running"
                ),
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
