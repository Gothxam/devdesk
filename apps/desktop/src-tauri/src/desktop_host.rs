//! The Tauri half of desktop host integration.
//!
//! `devdesk-core::desktop` decides which host windows should exist and when to
//! re-attach; this executes those decisions against Tauri and
//! `devdesk-platform`. The same split as [`crate::surface`], and for the same
//! reason: the multi-monitor and Explorer-restart behaviour is then testable on
//! a machine with one display and a running shell.
//!
//! `DR-6`: no `#[cfg(target_os)]` here. The native handle is reached through
//! `raw-window-handle`, which answers on every platform — a runtime `match` that
//! returns `None` off Windows, rather than code that only compiles on one OS.
//!
//! `DR-7` keeps this thin: every function is a step, and no function decides
//! anything a test could not reach.

use std::sync::{Arc, Mutex};

use devdesk_core::desktop::{
    DesktopMode, HostPlan, HostWindow, HostWindowChange, HostWindowId, ModeRequest,
    ReattachTrigger, RecoveryClock, RecoveryState, MODE_ENV_VAR, RECOVERY_DEBOUNCE,
};
use devdesk_display::DisplayGraph;
use devdesk_platform::{
    PlatformBackend, PlatformFeature, ShellEvent, ShellEventSink, SurfaceLayer,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// The band host windows attach to.
///
/// `Desktop`, not `Wallpaper`. A window parented into `WorkerW` sits behind
/// `SHELLDLL_DefView`, which covers the whole desktop and takes every click on
/// it — so a wallpaper-parented desktop can never be clicked, and `DH-17`'s
/// input region would have nothing to admit. The `Desktop` band is above the
/// icons and below every ordinary window, which is both what `DH-16` asks for
/// ("behind normal windows") and where an interactive widget can live.
const HOST_LAYER: SurfaceLayer = SurfaceLayer::Desktop;

/// The live desktop host.
///
/// Managed by Tauri so the shell-restart callback and the hotplug path can both
/// reach it. One instance for the whole process: Explorer restarting is a single
/// event that invalidates every attachment at once.
pub struct DesktopHost {
    app: AppHandle,
    state: Mutex<HostState>,
}

/// Everything the host mutates, behind one lock.
///
/// One lock rather than one per field: every operation reads the plan and the
/// recovery state together, and two locks taken in two orders is how a hotplug
/// during a shell restart deadlocks.
struct HostState {
    /// The host windows that currently exist.
    plan: HostPlan,

    /// Restart tracking (`DH-9`…`DH-12`).
    recovery: RecoveryState,

    /// Where this machine ended up.
    mode: DesktopMode,
}

impl DesktopHost {
    /// Creates a host that has attached nothing yet.
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            state: Mutex::new(HostState {
                plan: HostPlan::empty(),
                recovery: RecoveryState::new(),
                mode: DesktopMode::Windowed {
                    reason: "the desktop host has not started yet".to_owned(),
                },
            }),
        }
    }

    /// Brings the host windows in line with a topology.
    ///
    /// The one entry point: startup, hotplug, and shell-restart recovery all
    /// call this. Running one path rather than three is what makes `DH-11`
    /// ("recovery re-runs attachment from the beginning") true by construction
    /// instead of by remembering to.
    pub fn apply(&self, backend: &dyn PlatformBackend, graph: &DisplayGraph) -> DesktopMode {
        let request = ModeRequest::from_env_value(std::env::var(MODE_ENV_VAR).ok().as_deref());
        let supported = backend
            .supports(PlatformFeature::WallpaperLayer)
            .is_available();

        if !request.should_attempt(supported) {
            return self.settle(DesktopMode::Windowed {
                reason: window_mode_reason(request, backend),
            });
        }

        let next = HostPlan::for_graph(graph);

        let Ok(mut state) = self.state.lock() else {
            return DesktopMode::Windowed {
                reason: "the desktop host state is unreadable".to_owned(),
            };
        };

        let changes = state.plan.changes_to(&next);
        let origin = next.virtual_origin();

        for change in &changes {
            if let Err(reason) = self.execute(backend, change, (origin.x, origin.y)) {
                // DH-4: never a half-attached window. Both plans are torn down
                // — the one being built and whatever was already there — so
                // window mode starts from a desk with nothing on it.
                self.tear_down(&state.plan);
                self.tear_down(&next);
                state.plan = HostPlan::empty();
                state.mode = DesktopMode::Windowed { reason };

                return state.mode.clone();
            }
        }

        let monitors = next.len();
        state.plan = next;
        state.mode = DesktopMode::Attached { monitors };

        state.mode.clone()
    }

    /// Records a shell-restart hint (`DH-10`).
    ///
    /// Only records — creating windows inside a window procedure on the
    /// platform's thread is exactly what the sink's contract prohibits.
    ///
    /// Returns whether this hint **started** a burst. Explorer emits more than
    /// one `TaskbarCreated` on some builds, and only the first needs a waiter:
    /// the rest reopen the debounce window the waiter is already sitting on.
    pub fn note_shell_restart(&self, at: RecoveryClock) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };

        let started = !state.recovery.is_pending();
        state.recovery.hint(at);

        started
    }

    /// Whether a restart is still waiting to be handled.
    #[must_use]
    pub fn is_pending(&self) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.recovery.is_pending())
    }

    /// Records an attempt that could not even be made.
    ///
    /// Counted as a failure so `DH-12`'s ceiling is reached. A machine whose
    /// displays cannot be enumerated will not attach on the next try either,
    /// and not counting it would retry forever.
    pub fn record_failed_recovery(&self, at: RecoveryClock) {
        if let Ok(mut state) = self.state.lock() {
            state.recovery.attempted(at, false);
        }
    }

    /// Whether it is time to re-attach.
    #[must_use]
    pub fn poll_recovery(&self, now: RecoveryClock) -> ReattachTrigger {
        self.state
            .lock()
            .map_or(ReattachTrigger::Wait, |state| state.recovery.poll(now))
    }

    /// Re-runs attachment after a shell restart (`DH-11`).
    ///
    /// Re-enumerates displays rather than reusing the last topology: a restart
    /// can coincide with a resolution change, and re-attaching against stale
    /// topology puts host windows off-screen.
    pub fn recover(&self, backend: &dyn PlatformBackend, graph: &DisplayGraph, at: RecoveryClock) {
        // Everything is orphaned — the container they were parented into is
        // gone — so every window is destroyed and the plan emptied before
        // re-applying. A diff against the stale plan would decide nothing had
        // changed, and leaving the windows would make every `Create` collide
        // with a label that already exists.
        if let Ok(mut state) = self.state.lock() {
            self.tear_down(&state.plan);
            state.plan = HostPlan::empty();
        }

        let mode = self.apply(backend, graph);

        if let Ok(mut state) = self.state.lock() {
            state.recovery.attempted(at, mode.is_attached());
        }
    }

    /// Applies one change.
    fn execute(
        &self,
        backend: &dyn PlatformBackend,
        change: &HostWindowChange,
        origin: (i32, i32),
    ) -> Result<(), String> {
        match change {
            HostWindowChange::Create(window) => self.create(backend, window, origin),
            HostWindowChange::Move(window) => self.reposition(window, origin),
            HostWindowChange::Destroy(id) => {
                self.destroy(id);
                Ok(())
            }
        }
    }

    /// Creates a host window and attaches it.
    ///
    /// Created **hidden**, like every other DevDesk window. `AC-FRE-1.1` is not
    /// relaxed for the desktop: a full-monitor window flashing white before it
    /// paints is the same defect at the largest possible size. The shell reveals
    /// it through `shell_report_first_frame` once its webview has painted.
    fn create(
        &self,
        backend: &dyn PlatformBackend,
        window: &HostWindow,
        origin: (i32, i32),
    ) -> Result<(), String> {
        let label = label_for(&window.id);

        let built = WebviewWindowBuilder::new(&self.app, &label, entry_url(&window.id))
            .visible(false)
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .build()
            .map_err(|error| {
                format!(
                    "host window for {} could not be created: {error}",
                    window.id
                )
            })?;

        let handle = native_handle(&built).ok_or_else(|| {
            format!(
                "host window for {} has no native handle on this platform",
                window.id
            )
        })?;

        backend
            .attach_to_layer(handle, HOST_LAYER)
            .map_err(|error| format!("{} could not be attached: {error}", window.id))?;

        // DH-16: the desktop underneath keeps working. Click-through first and
        // an input region later, once the compositor reports which surfaces are
        // interactive — the safe order, because a window that admits nothing is
        // harmless and one that admits everything has already swallowed a click.
        backend
            .set_click_through(handle, true)
            .map_err(|error| format!("{} could not be made click-through: {error}", window.id))?;

        place(&built, window, origin)
    }

    /// Moves an existing host window to match a changed monitor.
    fn reposition(&self, window: &HostWindow, origin: (i32, i32)) -> Result<(), String> {
        let label = label_for(&window.id);

        let existing = self
            .app
            .get_webview_window(&label)
            .ok_or_else(|| format!("no host window labelled {label}"))?;

        place(&existing, window, origin)
    }

    /// Destroys a host window.
    ///
    /// A window that is already gone is not an error: teardown ordering is not
    /// something a caller should have to reason about, the same rule the surface
    /// sink follows.
    fn destroy(&self, id: &HostWindowId) {
        if let Some(existing) = self.app.get_webview_window(&label_for(id)) {
            let _ = existing.destroy();
        }
    }

    /// Destroys every window a plan describes.
    fn tear_down(&self, plan: &HostPlan) {
        for window in plan.windows() {
            self.destroy(&window.id);
        }
    }

    /// Records a mode without touching any window.
    fn settle(&self, mode: DesktopMode) -> DesktopMode {
        if let Ok(mut state) = self.state.lock() {
            state.mode = mode.clone();
        }

        mode
    }
}

/// The Tauri window label for a host window.
///
/// Prefixed so it cannot collide with a surface label or with the shell's own,
/// and derived from the monitor id, which is already an opaque key. Tauri labels
/// take a restricted character set, so anything outside it becomes `-` — a
/// collision would point two monitors at one window, which the uniqueness of the
/// monitor id makes vanishingly unlikely and which `DH-13` would catch as a
/// missing display.
fn label_for(id: &HostWindowId) -> String {
    let sanitised: String = id
        .monitor()
        .as_str()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();

    format!("desktop-host-{sanitised}")
}

/// The URL a host window loads: the shell, told which monitor it is on.
///
/// The monitor id travels in the query string because the shell has to know it
/// before it can place anything, and a command it would have to call after load
/// would mean one frame composed against the wrong display. Not the label: the
/// label is sanitised for Tauri's character set and cannot be turned back into
/// an id.
///
/// Percent-encoded by hand rather than by a dependency — the id is an opaque key
/// that can contain `\`, `#`, `&`, and `?`, and every one of those would end the
/// value early.
fn entry_url(id: &HostWindowId) -> WebviewUrl {
    let encoded: String = id
        .monitor()
        .as_str()
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect();

    WebviewUrl::App(format!("index.html?monitor={encoded}").into())
}

/// Positions and sizes a host window.
///
/// In **physical** pixels, converted out of virtual-screen space by the origin
/// (`DH-14`). The size is set logically so the webview inside lays out at this
/// monitor's scale (`WD-2`) rather than the one Tauri inherited from whichever
/// display the process started on.
fn place<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    planned: &HostWindow,
    origin: (i32, i32),
) -> Result<(), String> {
    window
        .set_position(PhysicalPosition {
            x: planned.bounds.origin.x - origin.0,
            y: planned.bounds.origin.y - origin.1,
        })
        .map_err(|error| format!("{} could not be positioned: {error}", planned.id))?;

    window
        .set_size(PhysicalSize {
            width: planned.bounds.size.width,
            height: planned.bounds.size.height,
        })
        .map_err(|error| format!("{} could not be sized: {error}", planned.id))?;

    Ok(())
}

/// The native handle for a Tauri window, if this platform has one.
///
/// A runtime `match`, not a `#[cfg]` (`DR-6`). Every arm but Win32 answers
/// `None`, which the caller reports as an unsupported platform rather than
/// failing to compile.
fn native_handle<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Option<devdesk_platform::WindowHandle> {
    let handle = window.window_handle().ok()?;

    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => {
            // Through `usize` rather than a checked `isize` conversion: a handle
            // with the high bit set is a valid `HWND` and would fail a signed
            // range check, which would drop exactly the windows that are
            // hardest to reproduce.
            let raw = isize::from(win32.hwnd).cast_unsigned();

            Some(devdesk_platform::WindowHandle::from_owned_window(
                u64::try_from(raw).ok()?,
            ))
        }
        _ => None,
    }
}

/// Why this machine is in window mode.
///
/// `XP-3`: never silent. The three cases read differently on purpose — an
/// operator who asked for window mode should not be told their machine cannot
/// do desktop mode.
fn window_mode_reason(request: ModeRequest, backend: &dyn PlatformBackend) -> String {
    match request {
        ModeRequest::ForceWindowed => {
            format!("{MODE_ENV_VAR} asked for window mode")
        }
        ModeRequest::Auto | ModeRequest::ForceDesktop => backend
            .supports(PlatformFeature::WallpaperLayer)
            .note()
            .unwrap_or("this platform does not support desktop attachment")
            .to_owned(),
    }
}

/// A monotonic reading, shared between the sink and the waiter it starts.
pub type Clock = Arc<dyn Fn() -> RecoveryClock + Send + Sync>;

/// Subscribes the host to shell restarts (`DH-10`).
///
/// The sink records the hint and, if it started a burst, hands off to a waiter
/// that sleeps out the debounce. Doing the work in the sink itself would create
/// windows inside a window procedure on the platform's thread.
///
/// # Errors
///
/// Returns the platform's reason when the shell publishes no restart signal. Not
/// fatal: a desktop that cannot detect a restart still works until Explorer
/// restarts, which is better than refusing to start.
pub fn watch_shell_restarts(
    backend: &dyn PlatformBackend,
    app: AppHandle,
    clock: Clock,
) -> Result<(), String> {
    let sink = ShellEventSink::new(move |event| {
        let ShellEvent::Restarted = event;

        let Some(host) = app.try_state::<DesktopHost>() else {
            return;
        };

        if host.note_shell_restart(clock()) {
            wait_out_debounce(app.clone(), Arc::clone(&clock));
        }
    });

    backend
        .subscribe_shell_restart(sink)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Waits out the recovery debounce, then re-attaches on the main thread.
///
/// A thread that exists **only while a restart is pending**, so the idle budget
/// (`B-4`) pays nothing on a machine whose shell has not restarted. This is not
/// the polling `DH-10` prohibits: that is polling for `Progman` to discover
/// something the system announces, and this is waiting out a window opened by an
/// announcement already received.
fn wait_out_debounce(app: AppHandle, clock: Clock) {
    let spawned = std::thread::Builder::new()
        .name("devdesk-desktop-recovery".to_owned())
        .spawn(move || loop {
            std::thread::sleep(RECOVERY_DEBOUNCE);

            let Some(host) = app.try_state::<DesktopHost>() else {
                return;
            };

            match host.poll_recovery(clock()) {
                // A later hint reopened the window. Around again, rather than
                // acting on a shell that is still restarting.
                ReattachTrigger::Wait => {}

                ReattachTrigger::Reattach => {
                    let handle = app.clone();
                    let now = clock();

                    // On the main thread: window creation and the Win32 calls
                    // that follow it are thread-affine, and doing them here
                    // would be a race that only shows up on someone else's
                    // machine.
                    if app
                        .run_on_main_thread(move || reattach(&handle, now))
                        .is_err()
                    {
                        return;
                    }
                }

                ReattachTrigger::Abandon => {
                    eprintln!(
                        "devdesk: the desktop could not be re-attached after the shell \
                         restarted; staying in window mode"
                    );
                    return;
                }
            }

            if !host.is_pending() {
                return;
            }
        });

    if spawned.is_err() {
        // A desktop that stays detached is bad; a host that cannot start a
        // thread and says nothing about it is worse (XP-3).
        eprintln!("devdesk: no thread available to recover the desktop after a shell restart");
    }
}

/// Re-enumerates displays and re-attaches (`DH-11`).
///
/// Re-enumerating rather than reusing the last topology: a restart can coincide
/// with a resolution change, and re-attaching against stale topology puts host
/// windows off-screen.
fn reattach(app: &AppHandle, now: RecoveryClock) {
    let Some(host) = app.try_state::<DesktopHost>() else {
        return;
    };

    let backend = devdesk_platform::current_backend();

    match devdesk_display::enumerate(backend.as_ref()) {
        Ok(topology) => {
            let graph = DisplayGraph::build(Arc::new(topology));
            host.recover(backend.as_ref(), &graph, now);
        }
        Err(error) => {
            eprintln!("devdesk: re-enumeration after the shell restarted failed: {error}");

            // Recorded as a failure so the attempt counter advances and
            // `DH-12`'s ceiling is reached rather than retried forever.
            host.record_failed_recovery(now);
        }
    }
}
