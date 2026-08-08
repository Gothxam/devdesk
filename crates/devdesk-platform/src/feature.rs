//! Capability introspection: callers ask, never assume.
//!
//! XP-2 requires a caller to consult [`Support`] before offering a feature.
//! XP-3 requires an unsupported operation to say so with a reason. Between them
//! they close `AP-15` — the platform difference that presents to a user as
//! "nothing happens", reproduces on one operating system only, and carries no
//! log line explaining itself.

use core::fmt;

/// A platform capability a caller can ask about.
///
/// Deliberately granular. A single `DisplaySupport` value would force a backend
/// that enumerates monitors correctly but cannot read a serial number to report
/// either more or less than the truth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlatformFeature {
    /// Listing the attached displays with bounds and work area.
    MonitorEnumeration,
    /// A per-monitor scale factor, as opposed to one system-wide value.
    PerMonitorDpi,
    /// Notification when the display arrangement changes.
    DisplayChangeEvents,
    /// A port-stable device path for a display, so two identical panels are
    /// distinguishable.
    MonitorDevicePath,
    /// The manufacturer serial number from the display's EDID.
    MonitorSerial,
    /// Which physical connector a display is attached to.
    MonitorConnector,
    /// The exact refresh rate, as a rational rather than a rounded integer.
    ExactRefreshRate,
}

impl PlatformFeature {
    /// Every feature, for the XP-5 parity test.
    ///
    /// A backend that adds a method without adding it here would not be checked
    /// for an explicit support answer, which is the whole mechanism.
    pub const ALL: &'static [Self] = &[
        Self::MonitorEnumeration,
        Self::PerMonitorDpi,
        Self::DisplayChangeEvents,
        Self::MonitorDevicePath,
        Self::MonitorSerial,
        Self::MonitorConnector,
        Self::ExactRefreshRate,
    ];
}

impl fmt::Display for PlatformFeature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::MonitorEnumeration => "monitor-enumeration",
            Self::PerMonitorDpi => "per-monitor-dpi",
            Self::DisplayChangeEvents => "display-change-events",
            Self::MonitorDevicePath => "monitor-device-path",
            Self::MonitorSerial => "monitor-serial",
            Self::MonitorConnector => "monitor-connector",
            Self::ExactRefreshRate => "exact-refresh-rate",
        };
        f.write_str(name)
    }
}

/// How well the current platform supports a feature.
///
/// There is no `Unknown`. A backend that does not know whether it supports
/// something has already failed the caller, who must decide now whether to
/// offer the action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Support {
    /// Available with full fidelity.
    Full,
    /// Available with a caveat the UI must surface (XP-2, §19.3).
    Partial { note: &'static str },
    /// Not available. The reason is mandatory — it is what turns a silent
    /// no-op into a diagnosable one.
    Unsupported { reason: &'static str },
}

impl Support {
    /// Whether the feature can be used at all.
    #[must_use]
    pub const fn is_available(self) -> bool {
        matches!(self, Self::Full | Self::Partial { .. })
    }

    /// The caveat or the reason, whichever applies.
    #[must_use]
    pub const fn note(self) -> Option<&'static str> {
        match self {
            Self::Full => None,
            Self::Partial { note } => Some(note),
            Self::Unsupported { reason } => Some(reason),
        }
    }
}
