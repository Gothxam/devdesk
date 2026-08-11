//! A key combination that works when nothing of ours has focus.
//!
//! # Why this has to exist
//!
//! Every way of entering edit mode used to live *inside* the desktop window: a
//! button, a context menu, a `keydown` listener. In ambient mode that window is
//! click-through and parented beneath Explorer's icon layer, so it receives no
//! clicks and can never hold keyboard focus. Every trigger was therefore
//! unreachable from the state it was meant to leave, and the only thing the
//! shell ever managed to send was the `false` its own mount effect produced.
//!
//! A system-wide hotkey is the way out because it is delivered by the window
//! manager to a *registrant*, not to whatever has focus. It is the one input
//! path that does not first require the input path to work.
//!
//! # Shape
//!
//! `RegisterHotKey` posts `WM_HOTKEY` to a **thread**, not a window, so this
//! owns its thread and its message loop — the same pattern as [`super::watcher`]
//! and [`super::shell`], for the same reason. A hidden message-only window is
//! created purely so the loop has something to stop on: `PostThreadMessage` can
//! be lost if the thread is not yet pumping, and a window cannot.

use std::sync::mpsc;
use std::sync::OnceLock;
use std::thread::JoinHandle;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    MOD_SHIFT, MOD_WIN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, PostQuitMessage,
    RegisterClassW, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE, WM_DESTROY,
    WM_HOTKEY, WNDCLASSW,
};

use crate::error::PlatformError;
use crate::window::{Hotkey, HotkeySink, Modifiers};

use super::{last_error, to_wide};

/// The window class name. Registered once per process.
const CLASS_NAME: &str = "DevDeskHotkeyWatcher";

/// Whether the class has been registered, and whether that succeeded.
static CLASS_REGISTERED: OnceLock<bool> = OnceLock::new();

/// The id handed to `RegisterHotKey`. One hotkey, so one id.
const HOTKEY_ID: i32 = 1;

/// A live hotkey registration.
#[derive(Debug)]
pub(super) struct HotkeyHandle {
    /// The message-only window, as a raw address. `HWND` is not `Send`;
    /// `PostMessageW` is the documented cross-thread exception.
    hwnd: isize,
    thread: JoinHandle<()>,
}

impl HotkeyHandle {
    /// Unregisters the hotkey and waits for the thread to finish.
    pub(super) fn stop(self) {
        // SAFETY: posting to a window from another thread is supported.
        let _ = unsafe {
            PostMessageW(
                Some(HWND(self.hwnd as *mut _)),
                WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            )
        };

        // EM-1: a thread that will not stop must not take shutdown with it.
        let _ = self.thread.join();
    }
}

/// Registers a system-wide hotkey.
///
/// # Errors
///
/// [`PlatformError::OsCall`] when Windows refuses the combination, which it does
/// when another process already holds it. Reported rather than retried with a
/// different key: a hotkey the user was not told about is worse than none.
pub(super) fn register(hotkey: Hotkey, sink: HotkeySink) -> Result<HotkeyHandle, PlatformError> {
    let (tx, rx) = mpsc::channel::<Result<isize, PlatformError>>();

    let thread = std::thread::Builder::new()
        .name("devdesk-hotkey".to_owned())
        .spawn(move || run(hotkey, sink, &tx))
        .map_err(|error| PlatformError::Malformed {
            what: "hotkey thread",
            detail: error.to_string(),
        })?;

    match rx.recv() {
        Ok(Ok(hwnd)) => Ok(HotkeyHandle { hwnd, thread }),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            let _ = thread.join();
            Err(PlatformError::OsCall {
                call: "hotkey startup",
                code: 0,
            })
        }
    }
}

/// The hotkey thread: register, pump, unregister.
///
/// `RegisterHotKey` binds to the **calling thread**, so it has to happen here
/// rather than in `register` — a hotkey registered on the caller's thread would
/// post `WM_HOTKEY` to a queue nobody is reading.
fn run(hotkey: Hotkey, sink: HotkeySink, tx: &mpsc::Sender<Result<isize, PlatformError>>) {
    if !ensure_class_registered() {
        let _ = tx.send(Err(PlatformError::OsCall {
            call: "RegisterClassW",
            code: last_error(),
        }));
        return;
    }

    let hwnd = match create_message_window() {
        Ok(hwnd) => hwnd,
        Err(error) => {
            let _ = tx.send(Err(error));
            return;
        }
    };

    // `MOD_NOREPEAT` so holding the combination toggles once rather than
    // flickering the desktop in and out of edit mode at the key repeat rate.
    // SAFETY: registering against this thread; `None` targets the thread queue.
    let registered = unsafe {
        RegisterHotKey(
            None,
            HOTKEY_ID,
            to_win32_modifiers(hotkey.modifiers) | MOD_NOREPEAT,
            u32::from(hotkey.virtual_key),
        )
    };

    if let Err(error) = registered {
        let _ = tx.send(Err(super::os_call("RegisterHotKey", &error)));
        return;
    }

    if tx.send(Ok(hwnd.0 as isize)).is_err() {
        // Nobody is waiting for this registration any more.
        // SAFETY: unregistering what was just registered on this thread.
        let _ = unsafe { UnregisterHotKey(None, HOTKEY_ID) };
        return;
    }

    pump(&sink);

    // SAFETY: same thread that registered it, which is what Windows requires.
    let _ = unsafe { UnregisterHotKey(None, HOTKEY_ID) };
}

/// Runs the message loop until `WM_QUIT`, emitting on every `WM_HOTKEY`.
///
/// Filtered on **no window**, unlike the other watchers: `WM_HOTKEY` is posted
/// to the thread queue and carries no window, so a loop filtered to a window
/// would never see it. This is the one place where that filter must not be set.
fn pump(sink: &HotkeySink) {
    let mut message = MSG::default();

    loop {
        // SAFETY: `message` is a live local. `None` takes every message on this
        // thread's queue, which is where `WM_HOTKEY` arrives.
        let result = unsafe { GetMessageW(std::ptr::from_mut(&mut message), None, 0, 0) };

        // 0 is `WM_QUIT`, -1 is an error; both end the loop. Continuing after an
        // error is how a message loop becomes a spin loop.
        if result.0 <= 0 {
            return;
        }

        if message.message == WM_HOTKEY {
            sink.emit();
            continue;
        }

        // SAFETY: filled by the call above.
        unsafe { DispatchMessageW(std::ptr::from_ref(&message)) };
    }
}

/// Translates portable modifiers into the Win32 bitfield.
fn to_win32_modifiers(modifiers: Modifiers) -> HOT_KEY_MODIFIERS {
    let mut flags = HOT_KEY_MODIFIERS(0);

    if modifiers.control {
        flags |= MOD_CONTROL;
    }
    if modifiers.alt {
        flags |= MOD_ALT;
    }
    if modifiers.shift {
        flags |= MOD_SHIFT;
    }
    if modifiers.meta {
        flags |= MOD_WIN;
    }

    flags
}

/// Registers the window class, at most once per process.
fn ensure_class_registered() -> bool {
    *CLASS_REGISTERED.get_or_init(|| {
        let class_name = to_wide(CLASS_NAME);

        // SAFETY: returns this process's own module, always valid.
        let Ok(module) = (unsafe { GetModuleHandleW(PCWSTR::null()) }) else {
            return false;
        };

        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: module.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };

        // SAFETY: fully initialised, and Windows copies the definition.
        unsafe { RegisterClassW(std::ptr::from_ref(&class)) != 0 }
    })
}

/// A message-only window, purely so the loop has something to stop on.
fn create_message_window() -> Result<HWND, PlatformError> {
    let class_name = to_wide(CLASS_NAME);
    let window_name = to_wide("DevDesk hotkey watcher");

    // SAFETY: both strings are NUL-terminated and outlive the call.
    // `HWND_MESSAGE` keeps it off every desktop: it is never shown, never
    // composited, and is not a surface.
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(window_name.as_ptr()),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            None,
            None,
        )
    }
    .map_err(|_| PlatformError::OsCall {
        call: "CreateWindowExW",
        code: last_error(),
    })
}

/// The window procedure. Only `WM_DESTROY` matters; hotkeys never reach here.
///
/// # Safety
///
/// Called by Windows for a window this module created.
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_DESTROY {
        // SAFETY: posts `WM_QUIT` to this thread's queue, ending `pump`.
        unsafe { PostQuitMessage(0) };
        return LRESULT(0);
    }

    // SAFETY: the default handler turns `WM_CLOSE` into `DestroyWindow`, which
    // is how `stop` reaches `WM_DESTROY`.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}
