//! Windows DevDesk created, and the bands they attach to.
//!
//! `ADR-0005` `DH-20`: the handle is opaque outside this crate. Only the backend
//! knows it is an `HWND`, which is what keeps `DR-6`'s rule — no
//! `#[cfg(target_os)]` outside `devdesk-platform` — meaningful. A caller holds a
//! token and asks this crate to do things with it.

use crate::display::RawRect;

/// An OS window DevDesk created.
///
/// **`DH-2`: only DevDesk-created windows may be passed here.** A handle for a
/// window belonging to another process must never be constructed, which is why
/// the constructor is crate-internal — a caller cannot fabricate one from a
/// number it found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WindowHandle(u64);

impl WindowHandle {
    /// The native value, for the backend that owns this platform.
    #[must_use]
    pub const fn raw(self) -> u64 {
        self.0
    }


    /// A handle the host obtained from its own window.
    ///
    /// The one way in from outside, and it carries the obligation in its name:
    /// the caller is asserting the window is DevDesk's own (`DH-2`).
    #[must_use]
    pub const fn from_owned_window(native: u64) -> Self {
        Self(native)
    }
}

impl core::fmt::Display for WindowHandle {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "window#{:#x}", self.0)
    }
}

/// The z-order band a window is attached to.
///
/// `SYSTEM_ARCHITECTURE.md` §9.4's five. `DH-22`: every variant is accepted by
/// [`crate::PlatformBackend::attach_to_layer`] on every platform, and the ones a
/// platform cannot do return `Unsupported` — a caller asking "can this machine
/// do wallpaper" gets an answer rather than a compile error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SurfaceLayer {
    /// Behind the desktop icons. Windows: reparented into `WorkerW`.
    Wallpaper,
    /// Above the wallpaper, below ordinary windows.
    Desktop,
    /// Ordinary window behaviour.
    Normal,
    /// Always on top, non-activating.
    Overlay,
    /// Reserved to the core (`WD-9`).
    System,
}

impl SurfaceLayer {
    /// Whether attaching to this band needs platform-specific work (`WD-8`).
    ///
    /// `Normal` does not — an ordinary window is already there.
    #[must_use]
    pub const fn needs_attachment(self) -> bool {
        !matches!(self, Self::Normal)
    }
}

impl core::fmt::Display for SurfaceLayer {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::Wallpaper => "wallpaper",
            Self::Desktop => "desktop",
            Self::Normal => "normal",
            Self::Overlay => "overlay",
            Self::System => "system",
        })
    }
}

/// Something the shell did that DevDesk has to react to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellEvent {
    /// Explorer restarted. Everything parented to `WorkerW` is gone (`DH-9`).
    ///
    /// A **hint**, like a display change: the handler re-runs attachment from
    /// the beginning rather than trusting anything about the event itself.
    Restarted,
}

/// Where shell hints are delivered.
///
/// The same shape and the same obligation as [`crate::DisplayEventSink`]: called
/// from a platform thread, inside a window procedure on Windows, so the callback
/// must be cheap and must not block. Re-attaching belongs on the caller's own
/// thread, not in here.
#[derive(Clone)]
pub struct ShellEventSink(std::sync::Arc<dyn Fn(ShellEvent) + Send + Sync>);

impl ShellEventSink {
    /// Wraps a callback.
    #[must_use]
    pub fn new(sink: impl Fn(ShellEvent) + Send + Sync + 'static) -> Self {
        Self(std::sync::Arc::new(sink))
    }

    /// Delivers a hint.
    pub fn emit(&self, event: ShellEvent) {
        (self.0)(event);
    }
}

impl core::fmt::Debug for ShellEventSink {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ShellEventSink(..)")
    }
}

/// The input region a window admits clicks in.
///
/// `DH-17`: the union of the interactive surfaces the compositor reports.
/// Empty means the window takes no input at all, which is different from
/// having no region set — the latter admits everything.
pub type InputRegion<'a> = &'a [RawRect];
