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
//! Sending `Progman` the undocumented-but-stable message `0x052C` asks Explorer
//! to expose a `WorkerW` behind the desktop icons. **Where that `WorkerW` ends
//! up differs by Windows build**, and both shapes are live in the field:
//!
//! ```text
//! Windows 10                          Windows 11
//! ──────────                          ──────────
//! WorkerW           ← icons           Progman
//! └── SHELLDLL_DefView                ├── SHELLDLL_DefView   ← icons, on top
//! WorkerW           ← parent here     └── WorkerW            ← parent here
//! ```
//!
//! On 10 the wallpaper host is promoted to a **top-level sibling** of the window
//! holding the icons. On 11 it stays a **child of `Progman`**, listed after
//! `SHELLDLL_DefView` — which is to say beneath it in z-order, which is the
//! wallpaper slot.
//!
//! Both are checked, and whichever is found must own no `SHELLDLL_DefView`: the
//! `WorkerW` that holds the icons is the wrong one, and parenting into it would
//! put DevDesk in front of them. A build with neither shape degrades rather than
//! guessing — an 11 desktop also carries a crowd of unrelated 133×38 top-level
//! `WorkerW` windows, and picking one of those would attach the desktop to
//! something the size of a tooltip.
//!
//! Every step can fail, and `DH-6` requires that failure be a value: a machine
//! where `Progman` is absent (a session with no shell, some kiosk configurations,
//! Server Core) gets `Unsupported` with a reason and runs in window mode.

use std::time::Duration;

use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetAncestor, GetClassNameW, GetDesktopWindow,
    GetWindowLongPtrW, SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, GA_PARENT,
    GWL_EXSTYLE, HWND_BOTTOM, HWND_NOTOPMOST, HWND_TOPMOST, SMTO_NORMAL, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
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
        SurfaceLayer::Normal => detach(window),
        SurfaceLayer::Wallpaper => attach_to_wallpaper_host(window),
        SurfaceLayer::Desktop => sink_to_bottom(window),
        SurfaceLayer::Overlay => raise_to_top(window),

        // Reserved to the core (`WD-9`) and nothing claims it yet. Refused
        // rather than aliased onto `Overlay`: a band that silently means another
        // band is a band nobody can reason about.
        SurfaceLayer::System => Err(PlatformError::Unsupported {
            platform: super::WindowsBackend::platform_id(),
            feature: PlatformFeature::WallpaperLayer,
            reason: "the system band is reserved and has no attachment path yet",
        }),
    }
}

/// Lifts a window out of the desktop and puts it in front of everything.
///
/// The `Overlay` band, and the **only** band in which a host window is
/// reachable by the mouse. Clearing `WS_EX_TRANSPARENT` is not enough on its
/// own and never can be: a window parented into `WorkerW` sits beneath
/// `SHELLDLL_DefView`, so hit testing finds Explorer's icon layer first. This
/// is what edit mode needs — the window has to *move*, not merely restyle.
///
/// Three steps, in this order:
///
/// 1. **Unparent.** While the window is a `WorkerW` child its z-order is only
///    relative to its siblings there, and no amount of raising escapes the
///    parent. Nothing above can be reached from inside.
/// 2. **Clear `WS_EX_NOACTIVATE`.** A window that cannot be activated cannot
///    hold keyboard focus, and a webview with no focus receives no `keydown` —
///    so `Escape` would not leave edit mode.
/// 3. **`HWND_TOPMOST`.** Above ordinary windows, because the user is editing
///    their desktop and the thing being edited has to be the thing in front.
fn raise_to_top(window: WindowHandle) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);

    // Already here? Then nothing to do, and doing it anyway is actively
    // harmful: `SetParent` on a window hosting a live WebView2 makes the webview
    // reload, and a reload runs the page-load handler that asked for this — an
    // unconditional re-attach from there never terminates. It was observed
    // taking Explorer down with it.
    if is_top_level(hwnd) && is_topmost(hwnd) {
        return Ok(());
    }

    detach(window)?;

    // SAFETY: reading the extended style of a window this process owns.
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let wanted = current & !isize::try_from(WS_EX_NOACTIVATE.0).unwrap_or(0);

    if wanted != current {
        super::clear_last_error();

        // SAFETY: setting the extended style of a window this process owns.
        let previous = unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted) };

        if previous == 0 {
            let code = super::last_error();

            if code != 0 {
                return Err(PlatformError::OsCall {
                    call: "SetWindowLongPtrW(clear WS_EX_NOACTIVATE)",
                    code,
                });
            }
        }
    }

    // SAFETY: a z-order change on a window this process owns. Position and size
    // are held; `SWP_FRAMECHANGED` flushes the style written above.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED,
        )
    }
    .map_err(|error| super::os_call("SetWindowPos(HWND_TOPMOST)", &error))
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
///
/// Drops the topmost flag as well as the parent. A window coming back from the
/// `Overlay` band that kept `HWND_TOPMOST` would sit in front of everything for
/// the rest of the session, which is the opposite of where the desktop belongs.
pub(super) fn detach(window: WindowHandle) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);

    // `GetAncestor`, not `GetParent`: for a window that is not `WS_CHILD` —
    // which ours are — `GetParent` answers with the *owner*, and a reparented
    // host window has no owner. Asking the wrong question here reports every
    // attached window as unattached.
    // SAFETY: reading the ancestry of a window this process owns.
    let parent = unsafe { GetAncestor(hwnd, GA_PARENT) };
    // SAFETY: the desktop window is a process-wide constant.
    let desktop = unsafe { GetDesktopWindow() };

    if !parent.is_invalid() && parent != desktop {
        // SAFETY: the child is ours; `None` restores the desktop as parent.
        unsafe { SetParent(hwnd, None) }
            .map_err(|error| super::os_call("SetParent(detach)", &error))?;
    }

    // SAFETY: a z-order change on a window this process owns.
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
    }
    .map_err(|error| super::os_call("SetWindowPos(HWND_NOTOPMOST)", &error))?;

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
    // Same reason as `raise_to_top`: re-parenting a window that is already
    // parented reloads its webview for no gain, and the reload asks for this
    // again.
    if let Some(host) = current_parent(to_hwnd(window)) {
        if is_worker_w(host) {
            return Ok(());
        }
    }

    let Some(progman) = progman() else {
        return Err(unsupported(
            "Progman is not present; this session has no Explorer desktop",
        ));
    };

    request_worker_w(progman);

    let Some(host) = wallpaper_host(progman) else {
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

/// The `WorkerW` that hosts the wallpaper, in whichever shape this build has.
///
/// Explorer has published two layouts, and neither is documented:
///
/// - **Windows 10.** `0x052C` promotes the wallpaper `WorkerW` to a *top-level
///   sibling* of the window that owns `SHELLDLL_DefView`.
/// - **Windows 11.** The wallpaper `WorkerW` is a *child of `Progman`*, listed
///   after `SHELLDLL_DefView` — which is to say beneath it in z-order, which is
///   exactly the wallpaper slot.
///
/// The sibling form is tried first, because a build that has it also has a crowd
/// of unrelated 133×38 `WorkerW` windows the child lookup must not be reached
/// for. Both candidates are then required to own no `SHELLDLL_DefView`: the one
/// that holds the icons is the wrong `WorkerW`, and parenting into it would put
/// DevDesk in front of them.
fn wallpaper_host(progman: HWND) -> Option<HWND> {
    sibling_of_icon_host()
        .or_else(|| child_worker_w(progman))
        .filter(|candidate| !owns_icons(*candidate))
}

/// A `WorkerW` child of `Progman` (the Windows 11 layout).
fn child_worker_w(progman: HWND) -> Option<HWND> {
    let worker = to_wide("WorkerW");

    // SAFETY: a child lookup on a window this process did not create but does
    // not modify. Reading the window tree is not modifying it (`DH-1`).
    unsafe { FindWindowExW(Some(progman), None, PCWSTR(worker.as_ptr()), PCWSTR::null()) }.ok()
}

/// Whether a window owns the desktop icon list.
fn owns_icons(candidate: HWND) -> bool {
    let shell_view = to_wide("SHELLDLL_DefView");

    // SAFETY: a child lookup on a live window handle.
    unsafe {
        FindWindowExW(
            Some(candidate),
            None,
            PCWSTR(shell_view.as_ptr()),
            PCWSTR::null(),
        )
    }
    .is_ok()
}

/// This window's real parent, or `None` if it is top-level.
///
/// `GetAncestor`, not `GetParent`: for a window that is not `WS_CHILD` — which
/// ours are — `GetParent` answers with the *owner*, and a reparented host window
/// has no owner. The wrong question reports every attached window as detached.
fn current_parent(hwnd: HWND) -> Option<HWND> {
    // SAFETY: reading the ancestry of a window this process owns.
    let parent = unsafe { GetAncestor(hwnd, GA_PARENT) };
    // SAFETY: a process-wide constant.
    let desktop = unsafe { GetDesktopWindow() };

    (!parent.is_invalid() && parent != desktop).then_some(parent)
}

/// Whether a window has no parent but the desktop.
fn is_top_level(hwnd: HWND) -> bool {
    current_parent(hwnd).is_none()
}

/// Whether a window carries `WS_EX_TOPMOST`.
fn is_topmost(hwnd: HWND) -> bool {
    // SAFETY: reading the extended style of a window this process owns.
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

    style & isize::try_from(WS_EX_TOPMOST.0).unwrap_or(0) != 0
}

/// Whether a window is a `WorkerW`.
fn is_worker_w(hwnd: HWND) -> bool {
    let mut class = [0_u16; 32];

    // SAFETY: writing into a local buffer whose length is passed alongside it.
    let written = unsafe { GetClassNameW(hwnd, &mut class) };

    written > 0 && String::from_utf16_lossy(&class[..written as usize]) == "WorkerW"
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

/// The top-level `WorkerW` sibling of the window that owns `SHELLDLL_DefView`.
///
/// The Windows 10 layout: Explorer moves the icons up into one `WorkerW` and
/// leaves an empty one behind it to hold the wallpaper.
///
/// Enumerating top-level windows rather than walking `Progman`'s children,
/// because Explorer promotes the wallpaper `WorkerW` to a top-level sibling of
/// `Progman` on most builds after `0x052C` — it is `Progman`'s child on some and
/// the desktop's on others, and depending on which would make this work on one
/// Windows version.
fn sibling_of_icon_host() -> Option<HWND> {
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
