//! Attaching a DevDesk window to the Windows desktop layer.
//!
//! `ADR-0005` `DH-1`: reparenting a **window DevDesk created** into `WorkerW` is
//! permitted, because it injects nothing, hooks nothing, alters no window owned
//! by Explorer, and leaves nothing behind. Nothing in here reads or writes a
//! registry value, a wallpaper setting, or any other state that outlives the
//! process (`DH-3`).
//!
//! # The sequence
//!
//! Explorer's desktop is two sibling windows under `Progman`:
//!
//! ```text
//! Progman
//! ├── WorkerW              ← the wallpaper host, sometimes absent
//! └── SHELLDLL_DefView     ← the icon list
//!     └── SysListView32
//! ```
//!
//! Sending `Progman` the undocumented-but-stable message `0x052C` asks it to
//! split the wallpaper onto a separate `WorkerW` that sits *behind* the icons.
//! After that the tree is:
//!
//! ```text
//! Progman
//! ├── WorkerW              ← icons live here now
//! │   └── SHELLDLL_DefView
//! └── WorkerW              ← empty; this is the one to parent into
//! ```
//!
//! The target is therefore "the `WorkerW` that has no `SHELLDLL_DefView` child",
//! not "the first `WorkerW`" — the two swap order between Windows builds and
//! between a fresh login and an Explorer restart.
//!
//! Every step can fail, and `DH-6` requires that failure be a value: a machine
//! where `Progman` is absent (a session with no shell, some kiosk configurations,
//! Server Core) gets `Unsupported` with a reason and runs in window mode.

use std::time::Duration;

use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetParent, GetWindowLongPtrW, SendMessageTimeoutW,
    SetParent, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_BOTTOM, SMTO_NORMAL,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::error::PlatformError;
use crate::feature::PlatformFeature;
use crate::window::{SurfaceLayer, WindowHandle};

use super::to_wide;

/// Ask `Progman` to spawn the wallpaper `WorkerW`.
///
/// Undocumented, and stable since Windows 7. If Microsoft removes it the
/// enumeration below simply finds nothing and the caller degrades (`T-1`).
const WM_SPAWN_WORKER_W: u32 = 0x052C;

/// How long to wait for `Progman` to answer.
///
/// `SendMessageTimeoutW` rather than `SendMessageW`: `Progman` belongs to another
/// process, and a synchronous send into a hung Explorer would block DevDesk's
/// startup indefinitely. A hung shell is exactly the case `DH-4` is about.
const PROGMAN_TIMEOUT: Duration = Duration::from_millis(1_000);

/// Attaches a window to a band.
///
/// `Normal` succeeds without doing anything: an ordinary top-level window is
/// already in that band, so the caller asked for the state it is in.
pub(super) fn attach(window: WindowHandle, layer: SurfaceLayer) -> Result<(), PlatformError> {
    match layer {
        SurfaceLayer::Normal => Ok(()),
        SurfaceLayer::Wallpaper => attach_to_wallpaper_host(window),
        SurfaceLayer::Desktop => sink_to_bottom(window),

        // Both are ordinary top-level windows with a topmost flag, which is the
        // window subsystem's business rather than the platform's. Modelling them
        // as attachment would put z-order policy in two places.
        SurfaceLayer::Overlay | SurfaceLayer::System => Err(PlatformError::Unsupported {
            platform: super::WindowsBackend::platform_id(),
            feature: PlatformFeature::WallpaperLayer,
            reason: "the overlay and system bands are ordinary topmost windows on Windows \
                     and need no attachment",
        }),
    }
}

/// Puts a window at the bottom of the ordinary z-order.
///
/// The `Desktop` band, and **not** `WorkerW`. A window parented into `WorkerW`
/// sits behind `SHELLDLL_DefView`, which covers the whole desktop and takes
/// every click on it — so a wallpaper-parented window can never receive input,
/// and `DH-17`'s input region would have nothing to admit. This band is above
/// the icons and below every ordinary window, which is where a widget the user
/// can actually click has to live.
///
/// `WS_EX_NOACTIVATE` (`DH-18`) so clicking a widget does not steal focus from
/// the user's editor, and `WS_EX_TOOLWINDOW` so the desktop stays out of
/// alt-tab.
fn sink_to_bottom(window: WindowHandle) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);

    // SAFETY: reading the extended style of a window this process owns.
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let wanted = current
        | isize::try_from(WS_EX_NOACTIVATE.0).unwrap_or(0)
        | isize::try_from(WS_EX_TOOLWINDOW.0).unwrap_or(0);

    if wanted != current {
        super::clear_last_error();

        // SAFETY: setting the extended style of a window this process owns.
        let previous = unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted) };

        // `0` means either "the previous style was 0" or failure, and a cleared
        // last-error is the only way to tell them apart.
        if previous == 0 {
            let code = super::last_error();

            if code != 0 {
                return Err(PlatformError::OsCall {
                    call: "SetWindowLongPtrW(WS_EX_NOACTIVATE)",
                    code,
                });
            }
        }
    }

    // SAFETY: a z-order change on a window this process owns. Position and size
    // are left alone; the caller owns those.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| super::os_call("SetWindowPos(HWND_BOTTOM)", &error))
}

/// Returns a window to being an ordinary top-level window.
pub(super) fn detach(window: WindowHandle) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);

    // A window that was never attached has no parent, and `SetParent(_, None)`
    // on it is a no-op rather than an error. Checking first keeps a redundant
    // detach out of the error path (see the trait documentation).
    // SAFETY: reading the parent of a window this process owns.
    if unsafe { GetParent(hwnd) }.is_err() {
        return Ok(());
    }

    // SAFETY: both windows are ours; `None` restores the desktop as parent.
    unsafe { SetParent(hwnd, None) }
        .map_err(|error| super::os_call("SetParent(detach)", &error))?;

    Ok(())
}

/// Whether this machine can host the wallpaper layer at all.
///
/// `DH-5`: answered before anything is attempted, so the UI never offers desktop
/// mode where it cannot work (`XP-2`). Asking costs one `FindWindowW`; it does
/// **not** spawn the `WorkerW`, because a capability query must not change the
/// thing it is querying.
pub(super) fn is_supported() -> bool {
    progman().is_some()
}

/// Reparents a window into the wallpaper `WorkerW`.
fn attach_to_wallpaper_host(window: WindowHandle) -> Result<(), PlatformError> {
    let Some(progman) = progman() else {
        return Err(unsupported(
            "Progman is not present; this session has no Explorer desktop",
        ));
    };

    request_worker_w(progman);

    let Some(host) = find_wallpaper_worker_w() else {
        return Err(unsupported(
            "Explorer did not expose a wallpaper WorkerW; the desktop may be managed \
             by a shell replacement",
        ));
    };

    // SAFETY: `window` is DevDesk's own (`DH-2`, enforced by the caller holding a
    // `WindowHandle`), and `host` is a container Explorer publishes for exactly
    // this purpose. No foreign window is modified — this changes *our* window's
    // parent pointer.
    unsafe { SetParent(to_hwnd(window), Some(host)) }
        .map_err(|error| super::os_call("SetParent(attach)", &error))?;

    Ok(())
}

/// Finds `Progman`, the desktop's root window.
fn progman() -> Option<HWND> {
    let class = to_wide("Progman");

    // SAFETY: a top-level class lookup with a null window name.
    unsafe { FindWindowW(PCWSTR(class.as_ptr()), PCWSTR::null()) }.ok()
}

/// Asks `Progman` to split the wallpaper onto its own `WorkerW`.
///
/// The result is deliberately ignored. On a system where the wallpaper `WorkerW`
/// already exists — a second DevDesk launch, or any other desktop tool that made
/// the same request — the message is a no-op, and treating a no-op as failure
/// would break the common case. Whether it worked is decided by the enumeration
/// that follows, which is the only honest test (`DH-4`).
fn request_worker_w(progman: HWND) {
    let mut result = 0usize;

    // SAFETY: a timed send to a window in another process. `SMTO_NORMAL` lets
    // this thread keep processing its own sent messages while it waits, which
    // avoids a deadlock if Explorer sends to us in the same window.
    let _ = unsafe {
        SendMessageTimeoutW(
            progman,
            WM_SPAWN_WORKER_W,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            u32::try_from(PROGMAN_TIMEOUT.as_millis()).unwrap_or(u32::MAX),
            Some(std::ptr::from_mut(&mut result).cast()),
        )
    };
}

/// The `WorkerW` that hosts the wallpaper.
///
/// Found by locating the window that owns `SHELLDLL_DefView` — the icon host —
/// and taking its next `WorkerW` sibling, which is the empty one Explorer
/// created to hold the wallpaper when it moved the icons up.
///
/// Enumerating top-level windows rather than walking `Progman`'s children,
/// because Explorer promotes the wallpaper `WorkerW` to a top-level sibling of
/// `Progman` on most builds after `0x052C` — it is `Progman`'s child on some and
/// the desktop's on others, and depending on which would make this work on one
/// Windows version.
fn find_wallpaper_worker_w() -> Option<HWND> {
    /// Receives the window found. Travels through `LPARAM` because `EnumWindows`
    /// takes a bare `extern "system"` function that can capture nothing, and the
    /// enumeration is synchronous — the pointer cannot outlive this frame.
    struct Search {
        found: Option<HWND>,
    }

    extern "system" fn visit(hwnd: HWND, param: LPARAM) -> BOOL {
        let shell_view = to_wide("SHELLDLL_DefView");
        let worker = to_wide("WorkerW");

        // SAFETY: a child lookup on a window the enumeration just handed us.
        let has_icons = unsafe {
            FindWindowExW(
                Some(hwnd),
                None,
                PCWSTR(shell_view.as_ptr()),
                PCWSTR::null(),
            )
        }
        .is_ok();

        if !has_icons {
            return true.into();
        }

        // This window owns the icons. The wallpaper host is its *next* sibling
        // `WorkerW` — the one Explorer created to hold the wallpaper when it
        // moved the icons up.
        // SAFETY: a sibling lookup rooted at the desktop.
        let Ok(sibling) =
            (unsafe { FindWindowExW(None, Some(hwnd), PCWSTR(worker.as_ptr()), PCWSTR::null()) })
        else {
            return true.into();
        };

        // SAFETY: `param` is the `&mut Search` the caller passed, alive for the
        // whole of the enumeration it is driving.
        let search = unsafe { &mut *(param.0 as *mut Search) };
        search.found = Some(sibling);
        false.into()
    }

    let mut search = Search { found: None };

    // SAFETY: enumeration with a callback that touches only the handle it is
    // given and the `Search` below. A `false` return stops it early, which the
    // callback uses on a hit; that surfaces as an error here and is not one.
    let _ = unsafe {
        EnumWindows(
            Some(visit),
            LPARAM(std::ptr::from_mut(&mut search) as isize),
        )
    };

    search.found
}

fn to_hwnd(window: WindowHandle) -> HWND {
    HWND(window.raw() as usize as *mut _)
}

fn unsupported(reason: &'static str) -> PlatformError {
    PlatformError::Unsupported {
        platform: super::WindowsBackend::platform_id(),
        feature: PlatformFeature::WallpaperLayer,
        reason,
    }
}
