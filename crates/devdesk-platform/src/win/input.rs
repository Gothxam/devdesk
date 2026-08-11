//! Deciding which clicks a DevDesk window takes.
//!
//! `ADR-0005` `DH-16`: a desktop host window covers a whole monitor, and if it
//! swallowed every click it would break the desktop it is decorating.
//!
//! # What a style can and cannot do
//!
//! `WS_EX_TRANSPARENT` decides whether a window is *skipped* during hit testing.
//! It does **not** decide where the window sits. A window parented into
//! `WorkerW` is beneath `SHELLDLL_DefView`, which covers the whole desktop, so
//! hit testing finds the icon layer first and never reaches ours — with the
//! style or without it. Measured on Windows 11 26200: with `GWL_EXSTYLE` at
//! exactly `0x00040110`, `WindowFromPoint` over a widget still returns
//! `SHELLDLL_DefView`.
//!
//! Clearing the style is therefore necessary and not sufficient. Making a host
//! window reachable is a **band** change ([`super::layer`]); this module only
//! decides whether a window that is already reachable takes the click. There is
//! deliberately no z-order call here — two places moving one window is how they
//! start disagreeing about where it is.

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetWindowLongPtrW, SetForegroundWindow, SetWindowDisplayAffinity,
    SetWindowLongPtrW, SetWindowPos, WindowFromPoint, GA_ROOT, GWL_EXSTYLE, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    WS_EX_TRANSPARENT,
};

use crate::display::RawRect;
use crate::error::PlatformError;
use crate::window::{StyleChange, WindowHandle};

/// Makes a window transparent to input, or takes it back.
///
/// Returns the extended style before and after. The caller logs both, and
/// reading it back separately would race whatever changes next.
pub(super) fn set_click_through(
    window: WindowHandle,
    enabled: bool,
) -> Result<StyleChange, PlatformError> {
    let hwnd = to_hwnd(window);

    // SAFETY: reading the extended style of a window this process owns.
    let before = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

    let transparent = isize::try_from(WS_EX_TRANSPARENT.0).unwrap_or(0);
    let updated = if enabled {
        before | transparent
    } else {
        before & !transparent
    };

    if updated != before {
        set_ex_style(hwnd, updated, "SetWindowLongPtrW(WS_EX_TRANSPARENT)")?;
    }

    // The frame flush. Windows caches frame attributes, and a style written with
    // `SetWindowLongPtrW` is not in effect until a `SetWindowPos` carrying
    // `SWP_FRAMECHANGED` tells the window manager to re-read them. Position,
    // size and z-order are all held: this call exists only to flush.
    // SAFETY: a frame flush on a window this process owns.
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
    }
    .map_err(|error| super::os_call("SetWindowPos(SWP_FRAMECHANGED)", &error))?;

    // Read back, so the caller reports what the system has rather than what it
    // was asked for.
    // SAFETY: reading the extended style of a window this process owns.
    let after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

    Ok(StyleChange {
        before: truncate(before),
        after: truncate(after),
    })
}

/// Gives a window keyboard focus.
///
/// Needed the moment a host window becomes interactive: a webview with no focus
/// receives no `keydown`, so `Escape` and `Ctrl+E` would never reach the shell
/// that listens for them.
///
/// # Errors
///
/// [`PlatformError::OsCall`] when Windows refuses. It does refuse — foreground
/// activation is only granted to a process that already owns the foreground or
/// is otherwise entitled. Reported rather than worked around: the window is
/// still usable by mouse, and defeating the shell's focus rules is not a fix.
pub(super) fn focus(window: WindowHandle) -> Result<(), PlatformError> {
    super::clear_last_error();

    // SAFETY: activating a window this process owns.
    if unsafe { SetForegroundWindow(to_hwnd(window)) }.as_bool() {
        return Ok(());
    }

    Err(PlatformError::OsCall {
        call: "SetForegroundWindow",
        code: super::last_error(),
    })
}

/// Which **top-level** window would receive a click at this screen point.
///
/// The honest test for "is this window reachable": it asks what the mouse asks.
///
/// The root, not the leaf. `WindowFromPoint` returns the deepest child, and for
/// a Tauri window that is WebView2's `Chrome_RenderWidgetHostHWND` — which
/// belongs to `msedgewebview2.exe`, a **different process**, even though it is a
/// child of ours. A caller comparing the leaf's process id to its own therefore
/// reports every genuine hit as a miss, which is exactly the false negative that
/// made a working edit mode look broken.
pub(super) fn window_at(x: i32, y: i32) -> u64 {
    // SAFETY: a hit test against the desktop. Reads window state, changes none.
    let hit = unsafe { WindowFromPoint(POINT { x, y }) };

    if hit.is_invalid() {
        return 0;
    }

    // SAFETY: walking up from a window the hit test just returned.
    let root = unsafe { GetAncestor(hit, GA_ROOT) };

    if root.is_invalid() {
        hit.0 as usize as u64
    } else {
        root.0 as usize as u64
    }
}

/// Admits input only inside `regions`.
///
/// An **empty** slice admits nothing, which is a state the caller can ask for.
/// It is different from never calling this, which admits everything.
pub(super) fn set_input_region(
    window: WindowHandle,
    regions: &[RawRect],
) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);
    let combined = union_of(regions)?;

    // SAFETY: the window is ours and the region was just created. Ownership
    // passes to the system on success, which is why it is not deleted there.
    let result = unsafe { SetWindowRgn(hwnd, Some(combined), true) };

    if result == 0 {
        // Ownership did not pass; this side still holds it.
        // SAFETY: a region this function created and the system did not take.
        let _ = unsafe { DeleteObject(combined.into()) };

        return Err(PlatformError::OsCall {
            call: "SetWindowRgn",
            code: super::last_error(),
        });
    }

    Ok(())
}

/// Excludes a window from screen capture, or stops excluding it.
pub(super) fn exclude_from_capture(
    window: WindowHandle,
    excluded: bool,
) -> Result<(), PlatformError> {
    let affinity = if excluded {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };

    // SAFETY: setting display affinity on a window this process owns.
    unsafe { SetWindowDisplayAffinity(to_hwnd(window), affinity) }
        .map_err(|error| super::os_call("SetWindowDisplayAffinity", &error))
}

/// Builds one region from a list of rectangles.
///
/// Every intermediate region is deleted, including on the error path — a leaked
/// `HRGN` is a GDI handle leak that survives until process exit.
fn union_of(regions: &[RawRect]) -> Result<HRGN, PlatformError> {
    // SAFETY: an empty rectangle is a valid region and never fails.
    let combined = unsafe { CreateRectRgn(0, 0, 0, 0) };

    for rect in regions {
        let right = rect
            .x
            .saturating_add(i32::try_from(rect.width).unwrap_or(i32::MAX));
        let bottom = rect
            .y
            .saturating_add(i32::try_from(rect.height).unwrap_or(i32::MAX));

        // SAFETY: four integers; allocates a region or returns null.
        let piece = unsafe { CreateRectRgn(rect.x, rect.y, right, bottom) };

        if piece.is_invalid() {
            // SAFETY: the accumulator this function created.
            let _ = unsafe { DeleteObject(combined.into()) };

            return Err(PlatformError::OsCall {
                call: "CreateRectRgn",
                code: super::last_error(),
            });
        }

        // SAFETY: all three regions are live and owned here. Writing the result
        // into `combined` while reading it is supported.
        let _ = unsafe { CombineRgn(Some(combined), Some(combined), Some(piece), RGN_OR) };

        // SAFETY: `CombineRgn` copies; the piece is no longer needed.
        let _ = unsafe { DeleteObject(piece.into()) };
    }

    Ok(combined)
}

fn set_ex_style(hwnd: HWND, style: isize, call: &'static str) -> Result<(), PlatformError> {
    super::clear_last_error();

    // SAFETY: setting the extended style of a window this process owns.
    let previous = unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style) };

    // `0` means either "the previous style was 0" or failure, and a cleared
    // last-error is the only way to tell them apart.
    if previous == 0 {
        let code = super::last_error();

        if code != 0 {
            return Err(PlatformError::OsCall { call, code });
        }
    }

    Ok(())
}

/// The low 32 bits of a style word, which is all an extended style occupies.
const fn truncate(style: isize) -> u32 {
    #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
    {
        style as u32
    }
}

fn to_hwnd(window: WindowHandle) -> HWND {
    HWND(window.raw() as usize as *mut _)
}
