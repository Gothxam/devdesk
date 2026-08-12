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

/// The modifier keys a hotkey requires.
///
/// Named rather than a bitfield, because a bitfield at this boundary means every
/// caller needs the platform's constants and `DR-6` is the rule that they must
/// not have them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Modifiers {
    pub control: bool,
    pub alt: bool,
    pub shift: bool,
    /// The Windows key, or Command.
    pub meta: bool,
}

/// A system-wide key combination.
///
/// The virtual key is a raw platform code, which is the one place this surface
/// is not portable and says so. Naming every key would be a table that adds
/// nothing: the only caller has one combination to register.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hotkey {
    pub modifiers: Modifiers,
    /// A platform virtual-key code. On Windows, `VK_*`.
    pub virtual_key: u16,
}

impl Hotkey {
    /// `Ctrl` + `Shift` + the given key.
    #[must_use]
    pub const fn ctrl_shift(virtual_key: u16) -> Self {
        Self {
            modifiers: Modifiers {
                control: true,
                alt: false,
                shift: true,
                meta: false,
            },
            virtual_key,
        }
    }

    /// `Ctrl` + `Alt` + the given key.
    #[must_use]
    pub const fn ctrl_alt(virtual_key: u16) -> Self {
        Self {
            modifiers: Modifiers {
                control: true,
                alt: true,
                shift: false,
                meta: false,
            },
            virtual_key,
        }
    }
}

impl core::fmt::Display for Hotkey {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.modifiers.control {
            f.write_str("Ctrl+")?;
        }
        if self.modifiers.alt {
            f.write_str("Alt+")?;
        }
        if self.modifiers.shift {
            f.write_str("Shift+")?;
        }
        if self.modifiers.meta {
            f.write_str("Win+")?;
        }

        // Printable ASCII virtual keys are their own character on Windows, which
        // covers every letter and digit. Anything else prints as a code rather
        // than as a guess.
        match u8::try_from(self.virtual_key) {
            Ok(code) if code.is_ascii_alphanumeric() => write!(f, "{}", code as char),
            _ => write!(f, "VK({:#04X})", self.virtual_key),
        }
    }
}

/// Where a hotkey press is delivered.
///
/// Called from the platform's own thread, inside a message loop, so the callback
/// must be cheap and must not block — the same contract as every other sink here.
#[derive(Clone)]
pub struct HotkeySink(std::sync::Arc<dyn Fn() + Send + Sync>);

impl HotkeySink {
    /// Wraps a callback.
    #[must_use]
    pub fn new(sink: impl Fn() + Send + Sync + 'static) -> Self {
        Self(std::sync::Arc::new(sink))
    }

    /// Delivers a press.
    pub fn emit(&self) {
        (self.0)();
    }
}

impl core::fmt::Debug for HotkeySink {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("HotkeySink(..)")
    }
}

/// An extended style either side of a change.
///
/// Returned rather than logged in here, and read back from the system rather
/// than computed, so a caller reporting "before 0x…, after 0x…" is reporting
/// what Windows has and not what it was asked for. The two being equal after a
/// change was requested is the interesting case, and it is invisible unless both
/// numbers travel together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StyleChange {
    /// The extended style before the call.
    pub before: u32,
    /// The extended style the system reports after it.
    pub after: u32,
}

impl core::fmt::Display for StyleChange {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:#010X} -> {:#010X}", self.before, self.after)
    }
}

/// The input region a window admits clicks in.
///
/// `DH-17`: the union of the interactive surfaces the compositor reports.
/// Empty means the window takes no input at all, which is different from
/// having no region set — the latter admits everything.
pub type InputRegion<'a> = &'a [RawRect];
