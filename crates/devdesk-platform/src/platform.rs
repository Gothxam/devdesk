//! Which operating system, and which window system on it.
//!
//! XP-6: Linux is not one platform for window and display purposes. X11 and
//! Wayland differ on layering, click-through, and fractional scaling, and
//! treating them as one produces surfaces that silently fail to attach on
//! whichever half the developer does not run.

use core::fmt;

/// The operating system family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

impl fmt::Display for Platform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Windows => "windows",
            Self::MacOs => "macos",
            Self::Linux => "linux",
        };
        f.write_str(name)
    }
}

/// The window system actually in use, resolved at runtime.
///
/// Resolved rather than compiled in: a Linux build runs under X11 or Wayland
/// depending on the session it was launched into, and the difference decides
/// what the backend can honestly report as supported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WindowSystem {
    Win32,
    Quartz,
    X11,
    Wayland,
    /// The session type could not be determined. Reported rather than guessed:
    /// a wrong guess here becomes a feature that claims support and does nothing.
    Unknown,
}

impl fmt::Display for WindowSystem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Win32 => "win32",
            Self::Quartz => "quartz",
            Self::X11 => "x11",
            Self::Wayland => "wayland",
            Self::Unknown => "unknown",
        };
        f.write_str(name)
    }
}

/// The platform a backend is running on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PlatformId {
    pub platform: Platform,
    pub window_system: WindowSystem,
}

impl PlatformId {
    #[must_use]
    pub const fn new(platform: Platform, window_system: WindowSystem) -> Self {
        Self {
            platform,
            window_system,
        }
    }
}

impl fmt::Display for PlatformId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.platform, self.window_system)
    }
}
