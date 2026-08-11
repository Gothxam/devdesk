/**
 * Stage 6 — Win32 Interactivity & Input Handling
 *
 * Implements:
 * 1. `set_click_through` with mandatory `SetWindowPos(SWP_FRAMECHANGED)` so Win32 window manager
 *    flushes cached frame attributes and hit-test tables.
 * 2. `WindowFromPoint` target verification for hit-testing diagnostics.
 */

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{
  CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR,
};
use windows::Win32::UI::WindowsAndMessaging::{
  GetCursorPos, GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos,
  WindowFromPoint, GWL_EXSTYLE, HWND_BOTTOM, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE,
  SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_TRANSPARENT,
};

use crate::display::RawRect;
use crate::error::PlatformError;
use crate::window::WindowHandle;

/// Makes a window transparent to input, or takes it back.
pub(super) fn set_click_through(window: WindowHandle, enabled: bool) -> Result<(), PlatformError> {
  let hwnd = to_hwnd(window);

  // SAFETY: reading the extended style of a window this process owns.
  let before = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

  let transparent = isize::try_from(WS_EX_TRANSPARENT.0).unwrap_or(0);
  let updated = if enabled {
    before | transparent
  } else {
    before & !transparent
  };

  // Update extended style
  set_ex_style(hwnd, updated, "SetWindowLongPtrW(WS_EX_TRANSPARENT)")?;

  // MANDATORY: Call SetWindowPos with SWP_FRAMECHANGED to flush cached Win32 hit-test tables
  let insert_after = if enabled { HWND_BOTTOM } else { HWND_TOP };
  let swp_flags = SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | if enabled { SWP_NOACTIVATE } else { SWP_SHOWWINDOW };

  unsafe {
    let _ = SetWindowPos(hwnd, Some(insert_after), 0, 0, 0, 0, swp_flags);
  }

  let after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

  // WindowFromPoint verification check
  let mut cursor_pt = POINT { x: 0, y: 0 };
  let hit_raw = unsafe {
    let _ = GetCursorPos(&mut cursor_pt);
    let hit_hwnd = WindowFromPoint(cursor_pt);
    hit_hwnd.0 as usize as u64
  };
  let host_raw = hwnd.0 as usize as u64;
  let hit_match = hit_raw == host_raw;

  eprintln!(
    "devdesk: [WIN32_INTERACTIVITY] HWND {host_raw:#X} | click_through={enabled} | GWL_EXSTYLE before: {before:#010X}, after: {after:#010X} | WindowFromPoint at ({}, {}) -> Hit HWND: {hit_raw:#X} (Match: {hit_match})",
    cursor_pt.x, cursor_pt.y
  );

  Ok(())
}

/// Admits input only inside `regions`.
pub(super) fn set_input_region(
  window: WindowHandle,
  regions: &[RawRect],
) -> Result<(), PlatformError> {
  let hwnd = to_hwnd(window);
  let combined = union_of(regions)?;

  let result = unsafe { SetWindowRgn(hwnd, Some(combined), true) };

  if result == 0 {
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

  unsafe { SetWindowDisplayAffinity(to_hwnd(window), affinity) }
    .map_err(|error| super::os_call("SetWindowDisplayAffinity", &error))
}

fn union_of(regions: &[RawRect]) -> Result<HRGN, PlatformError> {
  let combined = unsafe { CreateRectRgn(0, 0, 0, 0) };

  for rect in regions {
    let right = rect
      .x
      .saturating_add(i32::try_from(rect.width).unwrap_or(i32::MAX));
    let bottom = rect
      .y
      .saturating_add(i32::try_from(rect.height).unwrap_or(i32::MAX));

    let piece = unsafe { CreateRectRgn(rect.x, rect.y, right, bottom) };

    if piece.is_invalid() {
      let _ = unsafe { DeleteObject(combined.into()) };
      return Err(PlatformError::OsCall {
        call: "CreateRectRgn",
        code: super::last_error(),
      });
    }

    let _ = unsafe { CombineRgn(Some(combined), Some(combined), Some(piece), RGN_OR) };
    let _ = unsafe { DeleteObject(piece.into()) };
  }

  Ok(combined)
}

fn set_ex_style(hwnd: HWND, style: isize, call: &'static str) -> Result<(), PlatformError> {
  super::clear_last_error();

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
