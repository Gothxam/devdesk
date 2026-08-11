//! Making a hidden window visible once it has something to show.
//!
//! `AC-FRE-1.1`: every DevDesk window is created hidden, because a window
//! flashing white before it paints is the defect the criterion names. Something
//! then has to decide when hidden stops being right.
//!
//! # Why the shell cannot decide alone
//!
//! The shell reports its first frame from a `requestAnimationFrame` callback,
//! and **that callback never runs in a hidden window**. Chromium stops the
//! compositor for a page nobody can see, so a window waiting for its own first
//! frame waits forever: the frame needs the compositor, the compositor needs the
//! window, and the window is waiting for the frame.
//!
//! This closes the loop from the other side. `PageLoadEvent::Finished` is
//! delivered by the webview host rather than the compositor, so it arrives on a
//! hidden window, and by then the document has parsed and the app's own scripts
//! have run — there is styled content to show. That is what `AC-FRE-1.1` is
//! about: not "wait for the first composited frame" as an end in itself, but
//! "never show a window with nothing in it".
//!
//! `shell_report_first_frame` stays wired and stays authoritative wherever it
//! does arrive first. Showing a window twice is a no-op, so the two cannot
//! disagree — neither can reveal an empty window.
//!
//! # Why anything has to run *after* the show
//!
//! Revealing a window rewrites its extended style. Whatever the host set before
//! the window was visible — input transparency, non-activation, staying out of
//! alt-tab — is gone by the time the user can see it, which is precisely when it
//! starts to matter. The caller therefore gets a hook that runs immediately
//! after the show, and uses it to put back what the reveal took.

use tauri::webview::PageLoadEvent;
use tauri::{Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

/// Reveals the window once its document has loaded, then runs `after_show`.
///
/// `after_show` runs on the webview's callback thread every time a page finishes
/// loading, which includes a reload — so it must be idempotent, and re-asserting
/// window state is exactly that.
pub fn when_content_loads<'a, R, M, F>(
    builder: WebviewWindowBuilder<'a, R, M>,
    after_show: F,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
    F: Fn(&WebviewWindow<R>) + Send + Sync + 'static,
{
    builder.on_page_load(move |window, payload| {
        if !matches!(payload.event(), PageLoadEvent::Finished) {
            return;
        }

        // Discarded rather than reported: this runs on the webview's callback,
        // where there is nobody to return an error to. A window that refuses to
        // show is a window the user cannot see, and the shell's own report is
        // the second chance at it.
        let _ = window.show();

        after_show(&window);
    })
}

/// Reveals the window and does nothing else.
pub fn when_content_loads_plain<'a, R, M>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
{
    when_content_loads(builder, |_| {})
}
