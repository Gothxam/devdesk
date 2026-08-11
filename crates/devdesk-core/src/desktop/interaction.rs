//! Whether the desktop is being looked at or being edited.
//!
//! The desktop has two states and they differ in more than a flag. Ambient, it
//! is scenery: behind the icons, transparent to input, taking no focus. Editing,
//! it is an application: in front, taking clicks, holding the keyboard.
//!
//! # Why this is a band, not a style
//!
//! The first implementation toggled `WS_EX_TRANSPARENT` and expected clicks to
//! arrive. They do not. A window parented into `WorkerW` sits beneath
//! `SHELLDLL_DefView`, which covers the whole desktop, so hit testing reaches
//! Explorer's icon layer and stops. Measured on Windows 11 26200: with the
//! extended style at exactly `0x00040110` — transparent cleared, which is what
//! the style toggle was aiming for — `WindowFromPoint` over a widget still
//! returned `SHELLDLL_DefView`.
//!
//! A window that cannot be reached cannot be made reachable by restyling it. It
//! has to **move**. That is what this type encodes: each mode names the band its
//! windows belong in, and switching modes is a band change that the style then
//! follows.

use devdesk_platform::SurfaceLayer;

/// What the desktop is currently for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InteractionMode {
    /// Scenery. Behind the icons, transparent to input, never focused.
    #[default]
    Ambient,

    /// Under the user's hands. In front, taking clicks and keys.
    Editing,
}

impl InteractionMode {
    /// The mode after a toggle.
    #[must_use]
    pub const fn toggled(self) -> Self {
        match self {
            Self::Ambient => Self::Editing,
            Self::Editing => Self::Ambient,
        }
    }

    /// The mode a boolean asks for.
    ///
    /// The IPC surface is a `bool` because that is what a checkbox sends. It
    /// becomes a named state at the boundary rather than being carried inward,
    /// so nothing downstream has to remember which way round `true` was.
    #[must_use]
    pub const fn from_editing(editing: bool) -> Self {
        if editing {
            Self::Editing
        } else {
            Self::Ambient
        }
    }

    /// Whether this is the editing state.
    #[must_use]
    pub const fn is_editing(self) -> bool {
        matches!(self, Self::Editing)
    }

    /// The band host windows belong in.
    ///
    /// `Editing` is `Overlay` — in front of ordinary windows — because the user
    /// is editing their desktop and the thing being edited has to be the thing
    /// in front. `Desktop` would put it above the icons but beneath the editor
    /// the user is reading instructions in, which is worse than either extreme.
    #[must_use]
    pub const fn band(self) -> SurfaceLayer {
        match self {
            Self::Ambient => SurfaceLayer::Wallpaper,
            Self::Editing => SurfaceLayer::Overlay,
        }
    }

    /// Whether clicks should pass through to whatever is beneath.
    ///
    /// Always the inverse of editing, and stated separately from the band
    /// because they answer to different rules: the band is about `DH-16` (the
    /// desktop underneath keeps working) and this is about `DH-19`.
    #[must_use]
    pub const fn click_through(self) -> bool {
        !self.is_editing()
    }

    /// Whether host windows should take keyboard focus on entering this mode.
    ///
    /// Only when editing, and it matters: a webview with no focus receives no
    /// `keydown`, so the key that *leaves* edit mode would never arrive and the
    /// user would be stuck in a desktop that had taken over their screen.
    #[must_use]
    pub const fn takes_focus(self) -> bool {
        self.is_editing()
    }
}

impl core::fmt::Display for InteractionMode {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::Ambient => "ambient",
            Self::Editing => "editing",
        })
    }
}

/// Where a request to change mode came from.
///
/// Carried into the logs because the two sources fail differently and the
/// distinction is otherwise invisible. A request from the shell means the
/// webview had input, which in ambient mode it cannot have — so an
/// `InteractionSource::Shell` request to *enter* editing is itself evidence that
/// the window was already reachable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractionSource {
    /// The system-wide hotkey. The only source that works in ambient mode,
    /// because it does not require the window to have input.
    Hotkey,

    /// The shell asked: a button, a context menu, or an in-page key.
    Shell,

    /// Startup, or a rebuild after the shell restarted.
    Restore,
}

impl core::fmt::Display for InteractionSource {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::Hotkey => "hotkey",
            Self::Shell => "shell",
            Self::Restore => "restore",
        })
    }
}
