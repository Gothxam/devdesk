//! Display-change notification on Windows.
//!
//! Windows delivers `WM_DISPLAYCHANGE` and `WM_DPICHANGED` to windows, not to
//! processes, so receiving them requires a window and a message loop. This
//! creates a **message-only** window — an `HWND_MESSAGE` child, never composited,
//! never visible, and not a surface. It exists solely to have something the
//! window manager can address.
//!
//! The loop runs on its own thread. Hosting it on the main thread would couple
//! topology notification to the Tauri event loop, and a busy UI thread would then
//! delay the arrangement restore that a docking event is supposed to trigger.
//!
//! WD-6: what leaves here is a *hint*. `WM_DISPLAYCHANGE` carries the new
//! resolution in its parameters and this deliberately ignores it — by the time
//! the message is read the arrangement may have changed again, and a subscriber
//! that trusted the payload would hold a topology that never existed.

use std::sync::mpsc;
use std::sync::OnceLock;
use std::thread::JoinHandle;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
    PostMessageW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW, GWLP_USERDATA, HWND_MESSAGE,
    MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE, WM_DESTROY, WM_DISPLAYCHANGE, WM_DPICHANGED,
    WNDCLASSW,
};

use crate::display::{DisplayEvent, DisplayEventSink};
use crate::error::PlatformError;

/// The window class name. Registered once per process.
const CLASS_NAME: &str = "DevDeskDisplayWatcher";

/// Whether the class has been registered, and whether that succeeded.
static CLASS_REGISTERED: OnceLock<bool> = OnceLock::new();

/// A live subscription.
#[derive(Debug)]
pub(super) struct WatcherHandle {
    /// The message-only window, as a raw address.
    ///
    /// Held as an integer because `HWND` is not `Send` — correctly, since most
    /// window operations are thread-affine. `PostMessageW` is the documented
    /// exception: it is safe to call from any thread, which is what makes an
    /// orderly shutdown from the owner's thread possible at all.
    hwnd: isize,
    thread: JoinHandle<()>,
}

impl WatcherHandle {
    /// Ends the subscription and waits for the thread to finish.
    ///
    /// Joins rather than detaching: the sink outlives the subscription only if
    /// the thread is known to have stopped, and a detached loop could deliver
    /// one more hint after the caller believed it had unsubscribed.
    pub(super) fn stop(self) {
        // SAFETY: posting to a window from another thread is supported. A window
        // already destroyed makes this fail, which is the state the join below
        // then confirms.
        let _ = unsafe {
            PostMessageW(
                Some(HWND(self.hwnd as *mut _)),
                WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            )
        };

        // A watcher thread that will not stop must not take the shutdown path
        // with it; the join result is deliberately discarded rather than
        // unwrapped (EM-1).
        let _ = self.thread.join();
    }
}

/// Starts a display-change subscription.
pub(super) fn start(sink: DisplayEventSink) -> Result<WatcherHandle, PlatformError> {
    let (tx, rx) = mpsc::channel::<Result<isize, PlatformError>>();

    let thread = std::thread::Builder::new()
        .name("devdesk-display-watcher".to_owned())
        .spawn(move || run(sink, &tx))
        .map_err(|error| PlatformError::Malformed {
            what: "display watcher thread",
            detail: error.to_string(),
        })?;

    match rx.recv() {
        Ok(Ok(hwnd)) => Ok(WatcherHandle { hwnd, thread }),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        // The thread ended before reporting. Its panic hook has already recorded
        // why; reporting a second, less specific failure here is the best this
        // layer can do without inventing a cause.
        Err(_) => {
            let _ = thread.join();
            Err(PlatformError::OsCall {
                call: "display watcher startup",
                code: 0,
            })
        }
    }
}

/// The watcher thread body: create the window, then pump messages until asked to stop.
fn run(sink: DisplayEventSink, tx: &mpsc::Sender<Result<isize, PlatformError>>) {
    if !ensure_class_registered() {
        let _ = tx.send(Err(PlatformError::OsCall {
            call: "RegisterClassW",
            code: last_error(),
        }));
        return;
    }

    // Boxed so the address is stable, and leaked into the window's user data for
    // the lifetime of the window. Reclaimed below, after the loop has ended and
    // no further message can reach the window procedure.
    let sink = Box::into_raw(Box::new(sink));

    let hwnd = match create_message_window(sink) {
        Ok(hwnd) => hwnd,
        Err(error) => {
            // SAFETY: the pointer came from `Box::into_raw` above and was never
            // stored anywhere, because window creation failed.
            drop(unsafe { Box::from_raw(sink) });
            let _ = tx.send(Err(error));
            return;
        }
    };

    if tx.send(Ok(hwnd.0 as isize)).is_err() {
        // Nobody is waiting for this subscription any more.
        // SAFETY: the window was created above and no message has been pumped,
        // so the user data pointer is still the one we set.
        drop(unsafe { Box::from_raw(sink) });
        return;
    }

    pump(hwnd);

    // SAFETY: `pump` returns only after `WM_QUIT`, which follows `WM_DESTROY`.
    // The window no longer exists, so no window procedure can read this pointer.
    drop(unsafe { Box::from_raw(sink) });
}

/// Registers the window class, at most once per process.
fn ensure_class_registered() -> bool {
    *CLASS_REGISTERED.get_or_init(|| {
        let class_name = to_wide(CLASS_NAME);

        // SAFETY: `GetModuleHandleW(None)` returns this process's own module,
        // which is always valid.
        let Ok(module) = (unsafe { GetModuleHandleW(PCWSTR::null()) }) else {
            return false;
        };

        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: module.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };

        // SAFETY: `class` is fully initialised and `class_name` outlives the call.
        // Windows copies the class definition, so neither needs to outlive it.
        unsafe { RegisterClassW(std::ptr::from_ref(&class)) != 0 }
    })
}

/// Creates the message-only window and attaches the sink to it.
fn create_message_window(sink: *mut DisplayEventSink) -> Result<HWND, PlatformError> {
    let class_name = to_wide(CLASS_NAME);
    let window_name = to_wide("DevDesk display watcher");

    // SAFETY: both strings are NUL-terminated and outlive the call. `HWND_MESSAGE`
    // as the parent is what makes this a message-only window: no z-order, no
    // painting, and no presence on any desktop.
    let hwnd = unsafe {
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
    })?;

    // SAFETY: `hwnd` was just created by this thread, and `GWLP_USERDATA` on a
    // class that declares no extra window memory is reserved for exactly this.
    unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, sink as isize) };

    Ok(hwnd)
}

/// Runs the message loop until `WM_QUIT`.
fn pump(hwnd: HWND) {
    let mut message = MSG::default();

    loop {
        // SAFETY: `message` is a live local. Filtering by `hwnd` keeps this loop
        // to its own window; thread-wide messages are nobody else's here, but
        // scoping it makes that true by construction rather than by assumption.
        let result = unsafe { GetMessageW(std::ptr::from_mut(&mut message), Some(hwnd), 0, 0) };

        // 0 is WM_QUIT, -1 is an error; both end the loop. Continuing after an
        // error is how a message loop becomes a spin loop.
        if result.0 <= 0 {
            return;
        }

        // SAFETY: `message` was filled by the call above.
        unsafe { DispatchMessageW(std::ptr::from_ref(&message)) };
    }
}

/// The window procedure.
///
/// Runs on the watcher thread. Everything it does is bounded: read a pointer,
/// call one callback, return. A slow window procedure stalls the message queue
/// that produced the event, so the subscriber's callback is contractually
/// required to be cheap (see [`DisplayEventSink`]).
///
/// # Safety
///
/// Called by Windows for a window whose `GWLP_USERDATA` is either null or a
/// pointer produced by `Box::into_raw::<DisplayEventSink>` and still live.
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_DISPLAYCHANGE | WM_DPICHANGED => {
            // SAFETY: set once at creation, cleared only after the loop ends.
            let sink = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const DisplayEventSink;

            if let Some(sink) = unsafe { sink.as_ref() } {
                let event = if message == WM_DPICHANGED {
                    DisplayEvent::ScaleChanged
                } else {
                    DisplayEvent::TopologyChanged
                };
                sink.emit(event);
            }

            LRESULT(0)
        }

        WM_DESTROY => {
            // SAFETY: documented behaviour of `PostQuitMessage` — it posts
            // `WM_QUIT` to this thread's queue, ending `pump`.
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }

        // SAFETY: the default handler is what turns `WM_CLOSE` into
        // `DestroyWindow`, which is how `stop` reaches `WM_DESTROY`.
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn last_error() -> u32 {
    // SAFETY: reads this thread's last-error value; no pointers involved.
    unsafe { windows::Win32::Foundation::GetLastError() }.0
}
