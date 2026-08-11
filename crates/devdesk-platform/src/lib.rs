//! The platform abstraction. All OS-specific behaviour crosses this boundary.
//!
//! XP-1: every operating-system difference is expressed as a method on
//! [`PlatformBackend`] and a [`Support`] answer, never as a `#[cfg]` in a caller.
//! DR-6 confines `#[cfg(target_os)]` to this crate, and
//! `scripts/lint-cfg-usage.mjs` fails the build on any other use of it.
//!
//! The rule exists because of `AP-15`. A platform difference expressed as a
//! silent `cfg` becomes a feature that does nothing on one operating system,
//! with no error and no log line, reproducing only for whoever runs the OS
//! nobody on the team uses. Here, the same difference is a value the caller must
//! read before acting.
//!
//! This crate answers **what the system reports**. What that means — identity,
//! coordinate spaces, topology — belongs to `devdesk-display` one layer up, which
//! is why [`RawMonitorInfo`] is a raw record rather than a domain type.
//!
//! Boundary: see `README.md`. Responsibilities are defined by
//! `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 and are not restated here.

pub mod backend;
pub mod display;
pub mod error;
pub mod feature;
pub mod platform;
pub mod unsupported;
pub mod window;

#[cfg(target_os = "windows")]
mod win;

pub use backend::PlatformBackend;
pub use display::{
    Connector, ConnectorKind, DisplayEvent, DisplayEventSink, RawMonitorInfo, RawRect,
    SubscriptionId,
};
pub use error::PlatformError;
pub use feature::{PlatformFeature, Support};
pub use platform::{Platform, PlatformId, WindowSystem};
pub use unsupported::UnsupportedBackend;
pub use window::{InputRegion, ShellEvent, ShellEventSink, SurfaceLayer, WindowHandle};

#[cfg(target_os = "windows")]
pub use win::WindowsBackend;

/// The backend for the operating system this build is running on.
///
/// Always returns a backend. A platform with no implementation gets
/// [`UnsupportedBackend`], which answers every capability with a reason —
/// `QA-9` requires a feature added on Windows to *compile and run* on macOS and
/// Linux, with unsupported paths returning a typed answer rather than panicking.
#[must_use]
pub fn current_backend() -> Box<dyn PlatformBackend> {
    #[cfg(target_os = "windows")]
    {
        Box::new(WindowsBackend::new())
    }

    #[cfg(target_os = "macos")]
    {
        Box::new(UnsupportedBackend::new(
            PlatformId::new(Platform::MacOs, WindowSystem::Quartz),
            "the macOS backend is not implemented yet; display enumeration, layering, \
             and autostart all need AppKit equivalents",
        ))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Box::new(UnsupportedBackend::new(
            PlatformId::new(Platform::Linux, linux_window_system()),
            "the Linux backend is not implemented yet; X11 and Wayland need separate \
             display and layering implementations",
        ))
    }
}

/// Which Linux window system this process is running under.
///
/// XP-6: resolved at runtime, never compiled in. The same binary runs under X11
/// and Wayland depending on the session it was launched into, and the difference
/// decides what layering and click-through can honestly claim to support.
#[cfg(all(unix, not(target_os = "macos")))]
fn linux_window_system() -> WindowSystem {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return WindowSystem::Wayland;
    }

    match std::env::var("XDG_SESSION_TYPE").as_deref() {
        Ok("wayland") => WindowSystem::Wayland,
        Ok("x11") => WindowSystem::X11,
        // Reported as unknown rather than defaulted to X11. A wrong guess here
        // produces a backend that claims a capability it does not have, which is
        // the failure mode `Support` exists to prevent.
        _ if std::env::var_os("DISPLAY").is_some() => WindowSystem::X11,
        _ => WindowSystem::Unknown,
    }
}

#[cfg(test)]
mod tests;
