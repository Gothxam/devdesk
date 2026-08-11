//! Deciding which clicks a DevDesk window takes.
//!
//! `ADR-0005` `DH-16`: a desktop host window covers a whole monitor, and if it
//! swallowed every click it would break the desktop it is decorating —
//! right-click menus, icon selection, drag-select would all stop working.
//!
//! Two mechanisms, for two different questions:
//!
//! - **`set_click_through`** (`DH-19`) — the whole window is transparent to
//!   input. `WS_EX_TRANSPARENT`, which makes hit-testing fall through to whatever
//!   is beneath. Independent of attachment; meaningful for any window.
//! - **`set_input_region`** (`DH-17`) — input is admitted only inside given
//!   rectangles. `SetWindowRgn`, whose region is both the input *and* the paint
//!   area, which is what makes a click between two widgets reach the desktop.
//!
//! A region rather than `WM_NCHITTEST`, because the compositor has already
//! computed which surfaces are interactive; asking it again per click would put
//! an IPC round trip on the input path (`AP-1`).

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW, GWL_EXSTYLE,
    WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_TRANSPARENT,
};

use crate::display::RawRect;
use crate::error::PlatformError;
use crate::window::WindowHandle;

/// Makes a window transparent to input, or takes it back.
pub(super) fn set_click_through(window: WindowHandle, enabled: bool) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);

    // SAFETY: reading the extended style of a window this process owns.
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

    let transparent = isize::try_from(WS_EX_TRANSPARENT.0).unwrap_or(0);
    let updated = if enabled {
        current | transparent
    } else {
        current & !transparent
    };

    if updated == current {
        // Already in the requested state. Returning early keeps the last-error
        // check below meaningful: `SetWindowLongPtrW` returns 0 both for "the
        // previous style was 0" and for failure, and the only way to tell them
        // apart is a cleared last-error, which a redundant call muddies.
        return Ok(());
    }

    set_ex_style(hwnd, updated, "SetWindowLongPtrW(WS_EX_TRANSPARENT)")
}

/// Admits input only inside `regions`.
///
/// An **empty** slice admits nothing, which is a state the caller can legitimately
/// ask for — a desktop with no interactive widgets on it. It is different from
/// never calling this, which admits everything.
///
/// Rectangles are in the window's client coordinates, which is what `SetWindowRgn`
/// expects. Rectangles that touch or overlap are fine: `RGN_OR` merges them.
pub(super) fn set_input_region(
    window: WindowHandle,
    regions: &[RawRect],
) -> Result<(), PlatformError> {
    let hwnd = to_hwnd(window);

    // An empty region rather than `None`. `SetWindowRgn(_, None, _)` clears the
    // region and admits everything — the opposite of what an empty list means.
    let combined = union_of(regions)?;

    // SAFETY: the window is ours and the region was just created. Ownership of
    // the region passes to the system on success, which is why it is not deleted
    // on that path.
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
/// The caller owns the result and must either hand it to `SetWindowRgn` or
/// delete it. Every intermediate region is deleted here, including on the error
/// path — a leaked `HRGN` is a GDI handle leak that survives until process exit.
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

        // SAFETY: four integers; the call allocates a region or returns null.
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
        // into `combined` while reading it is supported and documented.
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

    if previous == 0 {
        let code = super::last_error();

        if code != 0 {
            return Err(PlatformError::OsCall { call, code });
        }
    }

    Ok(())
}

fn to_hwnd(window: WindowHandle) -> HWND {
    HWND(window.raw() as usize as *mut _)
}
