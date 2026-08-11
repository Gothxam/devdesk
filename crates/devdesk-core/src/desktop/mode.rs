//! Whether this machine runs the desktop on the desktop, or in a window.
//!
//! `ADR-0005` `DH-7`: **the portable fallback is window mode.** Desktop mode is
//! an enhancement, never a requirement — a machine that cannot attach gets the
//! same widgets in an ordinary application window, with the reason surfaced
//! rather than a failure at startup.
//!
//! `DH-6` and `XP-3` between them mean the decision is never silent: every path
//! that ends in window mode carries a sentence saying why.

/// Where the desktop is running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopMode {
    /// Attached to the system desktop, one host window per monitor.
    Attached {
        /// How many monitors got a host window.
        monitors: usize,
    },

    /// An ordinary application window (`DH-7`).
    Windowed {
        /// Why, in a sentence a user could be shown.
        ///
        /// Owned rather than `&'static str`: the reason often quotes a system
        /// error, and a code the user can search for is worth more than a
        /// generic sentence.
        reason: String,
    },
}

impl DesktopMode {
    /// Whether the desktop is on the desktop.
    #[must_use]
    pub const fn is_attached(&self) -> bool {
        matches!(self, Self::Attached { .. })
    }

    /// Why this machine is in window mode, if it is.
    #[must_use]
    pub fn reason(&self) -> Option<&str> {
        match self {
            Self::Attached { .. } => None,
            Self::Windowed { reason } => Some(reason),
        }
    }
}

/// What the operator asked for, before anything is attempted.
///
/// Three states rather than a `bool`, because "the user did not say" and "the
/// user said no" call for different behaviour: the first falls back quietly on
/// a machine that cannot attach, and the second must never attach even where it
/// would work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ModeRequest {
    /// Attach where the platform supports it. The default.
    #[default]
    Auto,

    /// Never attach. An escape hatch that has to exist: a desktop-attached
    /// window has no title bar and no taskbar button, so a build that misbehaves
    /// needs a way to start in something the user can close.
    ForceWindowed,

    /// Attach even where `supports` says no, and report the real failure.
    ///
    /// For development. On a machine that genuinely cannot attach this produces
    /// the underlying `PlatformError` rather than the capability answer, which
    /// is the difference between "not supported" and the system call that said
    /// so.
    ForceDesktop,
}

impl ModeRequest {
    /// Reads the request from an environment value.
    ///
    /// Accepts what someone would actually type. An unrecognised value is
    /// `Auto` rather than an error: refusing to start because an environment
    /// variable was misspelled would turn a typo into a broken machine.
    #[must_use]
    pub fn from_env_value(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("0" | "off" | "false" | "no" | "window" | "windowed") => Self::ForceWindowed,
            Some("1" | "on" | "true" | "yes" | "desktop") => Self::ForceDesktop,
            _ => Self::Auto,
        }
    }

    /// Whether attachment should be attempted, given what the platform reports.
    #[must_use]
    pub const fn should_attempt(self, platform_supports: bool) -> bool {
        match self {
            Self::Auto => platform_supports,
            Self::ForceWindowed => false,
            Self::ForceDesktop => true,
        }
    }
}

/// The name of the environment variable that carries [`ModeRequest`].
pub const MODE_ENV_VAR: &str = "DEVDESK_DESKTOP_MODE";
