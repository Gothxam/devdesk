//! Monitor identity.
//!
//! WD-3: monitors are identified by a **stable fingerprint derived from display
//! identity**, never by OS enumeration index. Indices reorder across reboots and
//! docking events, and every layout bound to one silently relocates — which is
//! `PS-3`, the origin failure this project exists to fix.

use serde::{Deserialize, Serialize};

use crate::geometry::{PhysicalRect, ScaleFactor};

/// A stable identifier for one physical display.
///
/// Derived from what the display reports about itself, not from where it
/// happened to appear in an enumeration.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MonitorId(String);

impl MonitorId {
    /// Builds an id from display-reported identity.
    ///
    /// Two physically identical models attached at once must not collide, so the
    /// device path participates: it distinguishes the ports they are plugged
    /// into when the manufacturer strings are identical.
    #[must_use]
    pub fn from_identity(device_path: &str, manufacturer: &str, model: &str, serial: &str) -> Self {
        Self(format!("{device_path}|{manufacturer}|{model}|{serial}"))
    }

    /// The opaque identifier.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Everything known about one attached display.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorDescriptor {
    /// Stable identity (WD-3).
    pub id: MonitorId,
    /// Human-readable name, for a UI the user can match to hardware
    /// (`AC-MON-8.3`). Never used for identity: it is not unique.
    pub name: String,
    /// Full bounds in device pixels, including any area covered by OS chrome.
    pub bounds: PhysicalRect,
    /// The usable area, excluding taskbars and docks.
    ///
    /// Placement uses this, not `bounds`: a surface anchored to the bottom edge
    /// of `bounds` sits underneath the taskbar.
    pub work_area: PhysicalRect,
    /// This monitor's scale factor. Never global (WD-2).
    pub scale_factor: ScaleFactor,
    /// Refresh rate in millihertz, or `None` if the platform does not report it.
    ///
    /// Millihertz because 59.94 Hz is real, and rounding it to 60 makes a frame
    /// budget wrong by enough to matter (`PB-R1`).
    pub refresh_millihertz: Option<u32>,
    /// Whether the OS considers this the primary display.
    pub is_primary: bool,
}

impl MonitorDescriptor {
    /// Refresh rate in whole hertz, when reported.
    #[must_use]
    pub fn refresh_hz(&self) -> Option<f64> {
        self.refresh_millihertz.map(|mhz| f64::from(mhz) / 1000.0)
    }

    /// The frame interval this monitor implies, in milliseconds.
    ///
    /// `PB-R1` is refresh-relative: 60 Hz means 16.6 ms and 144 Hz means 6.9 ms.
    /// Falls back to 60 Hz when the platform reports no rate, because a missing
    /// rate must never produce an unbounded budget.
    #[must_use]
    pub fn frame_interval_ms(&self) -> f64 {
        match self.refresh_hz() {
            Some(hz) if hz > 0.0 => 1000.0 / hz,
            _ => 1000.0 / 60.0,
        }
    }
}
