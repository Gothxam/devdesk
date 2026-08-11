//! Noticing when Explorer restarts.
//!
//! `ADR-0005` `DH-9`: an Explorer restart destroys `WorkerW` and orphans
//! everything parented to it. Without detection the desktop silently disappears
//! until the next launch, which a user cannot tell apart from a crash.
//!
//! `DH-10`: detection is the `TaskbarCreated` registered message, which Explorer
//! broadcasts when the shell comes back. Polling for `Progman` is prohibited — it
//! spends the idle budget (`B-4`) discovering something the system announces.
//!
//! # Why this window is top-level and the display watcher's is not
//!
//! `TaskbarCreated` is *broadcast*, and a broadcast reaches **top-level windows
//! only**. A message-only window — an `HWND_MESSAGE` child, which is what
//! [`super::watcher`] uses — is not top-level and would never receive it. The
//! window here is therefore a real top-level window that is simply never shown:
//! zero-sized, `WS_EX_TOOLWINDOW` so it stays out of alt-tab, and created without
//! `WS_VISIBLE` so it never appears for even one frame (`AC-FRE-1.1`).
//!
//! `WD-6`: what leaves here is a *hint*, like a display change. The event carries
//! nothing, and the handler re-runs attachment from the beginning rather than
//! trusting anything about the moment it arrived (`DH-11`).

use std::sync::mpsc;
use std::sync::OnceLock;
use std::thread::JoinHandle;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
    PostMessageW, PostQuitMessage, RegisterClassW, RegisterWindowMessageW, SetWindowLongPtrW,
    GWLP_USERDATA, MSG, WM_CLOSE, WM_DESTROY, WNDCLASSW, WS_EX_TOOLWINDOW, WS_OVERLAPPED,
};

use crate::error::PlatformError;
use crate::window::{ShellEvent, ShellEventSink};

use super::{last_error, to_wide};

/// The window class name. Registered once per process.
const CLASS_NAME: &str = "DevDeskShellWatcher";

/// Whether the class has been registered, and whether that succeeded.
static CLASS_REGISTERED: OnceLock<bool> = OnceLock::new();

/// The id Explorer broadcasts on. Resolved once; it is per-session, not a constant.
static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();

/// A live shell-restart subscription.
#[derive(Debug)]
pub(super) struct ShellWatcherHandle {
    /// The hidden top-level window, as a raw address.
    ///
    /// An integer because `HWND` is not `Send`. `PostMessageW` is the documented
    /// cross-thread exception, which is what makes an orderly stop possible.
    hwnd: isize,
    thread: JoinHandle<()>,
}

impl ShellWatcherHandle {
    /// Ends the subscription and waits for the thread to finish.
    pub(super) fn stop(self) {
        // SAFETY: posting to a window from another thread is supported. A window
        // already destroyed makes this fail, which the join then confirms.
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

/// Starts a shell-restart subscription.
pub(super) fn start(sink: ShellEventSink) -> Result<ShellWatcherHandle, PlatformError> {
    let (tx, rx) = mpsc::channel::<Result<isize, PlatformError>>();

    let thread = std::thread::Builder::new()
        .name("devdesk-shell-watcher".to_owned())
        .spawn(move || run(sink, &tx))
        .map_err(|error| PlatformError::Malformed {
            what: "shell watcher thread",
            detail: error.to_string(),
        })?;

    match rx.recv() {
        Ok(Ok(hwnd)) => Ok(ShellWatcherHandle { hwnd, thread }),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            let _ = thread.join();
            Err(PlatformError::OsCall {
                call: "shell watcher startup",
                code: 0,
            })
        }
    }
}

/// The watcher thread body: create the window, then pump until asked to stop.
fn run(sink: ShellEventSink, tx: &mpsc::Sender<Result<isize, PlatformError>>) {
    if taskbar_created_message() == 0 {
        let _ = tx.send(Err(PlatformError::OsCall {
            call: "RegisterWindowMessageW(TaskbarCreated)",
            code: last_error(),
        }));
        return;
    }

    if !ensure_class_registered() {
        let _ = tx.send(Err(PlatformError::OsCall {
            call: "RegisterClassW",
            code: last_error(),
        }));
        return;
    }

    // Boxed for a stable address, held by the window's user data for the
    // window's lifetime, reclaimed after the loop when nothing can read it.
    let sink = Box::into_raw(Box::new(sink));

    let hwnd = match create_hidden_window(sink) {
        Ok(hwnd) => hwnd,
        Err(error) => {
            // SAFETY: from `Box::into_raw` above and never stored, because
            // window creation failed.
            drop(unsafe { Box::from_raw(sink) });
            let _ = tx.send(Err(error));
            return;
        }
    };

    if tx.send(Ok(hwnd.0 as isize)).is_err() {
        // SAFETY: no message has been pumped, so the user data pointer is still
        // the one set at creation.
        drop(unsafe { Box::from_raw(sink) });
        return;
    }

    pump(hwnd);

    // SAFETY: `pump` returns only after `WM_QUIT`, which follows `WM_DESTROY`.
    drop(unsafe { Box::from_raw(sink) });
}

/// The `TaskbarCreated` message id, resolved once per process.
///
/// `0` means registration failed, which is the only way this can fail — the name
/// is a plain string and the atom table is per-session.
fn taskbar_created_message() -> u32 {
    *TASKBAR_CREATED.get_or_init(|| {
        let name = to_wide("TaskbarCreated");

        // SAFETY: a NUL-terminated string that outlives the call.
        unsafe { RegisterWindowMessageW(PCWSTR(name.as_ptr())) }
    })
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

/// Creates the hidden top-level window and attaches the sink to it.
fn create_hidden_window(sink: *mut ShellEventSink) -> Result<HWND, PlatformError> {
    let class_name = to_wide(CLASS_NAME);
    let window_name = to_wide("DevDesk shell watcher");

    // SAFETY: both strings are NUL-terminated and outlive the call. No parent, so
    // this is top-level and receives broadcasts; no `WS_VISIBLE`, so it is never
    // shown; `WS_EX_TOOLWINDOW`, so it never appears in alt-tab or the taskbar.
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_TOOLWINDOW,
            PCWSTR(class_name.as_ptr()),
            PCWSTR(window_name.as_ptr()),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|_| PlatformError::OsCall {
        call: "CreateWindowExW",
        code: last_error(),
    })?;

    // SAFETY: just created by this thread; `GWLP_USERDATA` is reserved for the
    // application on a class that declares no extra window memory.
    unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, sink as isize) };

    Ok(hwnd)
}

/// Runs the message loop until `WM_QUIT`.
fn pump(hwnd: HWND) {
    let mut message = MSG::default();

    loop {
        // SAFETY: `message` is a live local. Filtered to this window; broadcasts
        // are delivered to the window, so the filter does not exclude them.
        let result = unsafe { GetMessageW(std::ptr::from_mut(&mut message), Some(hwnd), 0, 0) };

        // 0 is `WM_QUIT`, -1 is an error; both end the loop. Continuing after an
        // error is how a message loop becomes a spin loop.
        if result.0 <= 0 {
            return;
        }

        // SAFETY: filled by the call above.
        unsafe { DispatchMessageW(std::ptr::from_ref(&message)) };
    }
}

/// The window procedure.
///
/// # Safety
///
/// Called by Windows for a window whose `GWLP_USERDATA` is either null or a live
/// pointer from `Box::into_raw::<ShellEventSink>`.
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == taskbar_created_message() {
        // SAFETY: set once at creation, cleared only after the loop ends.
        let sink = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const ShellEventSink;

        if let Some(sink) = unsafe { sink.as_ref() } {
            sink.emit(ShellEvent::Restarted);
        }

        return LRESULT(0);
    }

    if message == WM_DESTROY {
        // SAFETY: posts `WM_QUIT` to this thread's queue, ending `pump`.
        unsafe { PostQuitMessage(0) };
        return LRESULT(0);
    }

    // SAFETY: the default handler turns `WM_CLOSE` into `DestroyWindow`, which is
    // how `stop` reaches `WM_DESTROY`.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}
