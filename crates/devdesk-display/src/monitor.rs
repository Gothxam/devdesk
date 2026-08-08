//! One attached display, as the rest of the system sees it.

use serde::{Deserialize, Serialize};

use devdesk_platform::{RawMonitorInfo, RawRect};

use crate::error::DisplayError;
use crate::geometry::{PhysicalPoint, PhysicalRect, PhysicalSize, ScaleFactor};
use crate::identity::{IdentityConfidence, MonitorId, MonitorIdentity};

/// The DPI Windows and every other platform report for a display at 100%.
const DPI_AT_100_PERCENT: f64 = 96.0;

/// Everything known about one attached display.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorDescriptor {
    /// What the display reported about which display it is (WD-3).
    pub identity: MonitorIdentity,
    /// Human-readable name, for a UI the user can match to hardware
    /// (`AC-MON-8.3`). Never used for identity: it is neither unique nor stable,
    /// and a user who renames a display must not lose the layout bound to it.
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
    /// Builds a descriptor from a platform record.
    ///
    /// # Errors
    ///
    /// [`DisplayError::UnusableDisplay`] when the record describes geometry no
    /// surface could be placed on — a zero-area display or a scale factor that
    /// would make every conversion produce absent coordinates. Rejecting here is
    /// the point: a `NaN` scale carried forward surfaces as a window at an
    /// impossible position, many layers from its cause.
    pub fn from_raw(raw: &RawMonitorInfo) -> Result<Self, DisplayError> {
        let device = raw
            .os_device_name
            .clone()
            .or_else(|| raw.device_path.clone())
            .unwrap_or_else(|| format!("#{}", raw.os_enumeration_index));

        if raw.bounds.width == 0 || raw.bounds.height == 0 {
            return Err(DisplayError::UnusableDisplay {
                device,
                field: "bounds",
                detail: format!("{}x{}", raw.bounds.width, raw.bounds.height),
            });
        }

        let scale_factor =
            ScaleFactor::new(f64::from(raw.dpi) / DPI_AT_100_PERCENT).ok_or_else(|| {
                DisplayError::UnusableDisplay {
                    device: device.clone(),
                    field: "scale factor",
                    detail: format!("{} dpi", raw.dpi),
                }
            })?;

        // A work area larger than the display, or absent entirely, means the
        // platform could not compute it. Falling back to full bounds costs a
        // surface being placed under the taskbar; treating the display as
        // unusable costs the user a monitor.
        let work_area = to_rect(raw.work_area);
        let work_area = if work_area.size.width == 0 || work_area.size.height == 0 {
            to_rect(raw.bounds)
        } else {
            work_area
        };

        Ok(Self {
            identity: MonitorIdentity::from_raw(raw),
            name: raw
                .friendly_name
                .clone()
                .or_else(|| raw.os_device_name.clone())
                .unwrap_or_else(|| "Display".to_owned()),
            bounds: to_rect(raw.bounds),
            work_area,
            scale_factor,
            refresh_millihertz: raw.refresh_millihertz,
            is_primary: raw.is_primary,
        })
    }

    /// The derived identity key.
    #[must_use]
    pub const fn id(&self) -> &MonitorId {
        self.identity.id()
    }

    /// The best confidence with which this display could ever be re-identified.
    #[must_use]
    pub fn identity_strength(&self) -> IdentityConfidence {
        self.identity.strength()
    }

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

fn to_rect(raw: RawRect) -> PhysicalRect {
    PhysicalRect {
        origin: PhysicalPoint { x: raw.x, y: raw.y },
        size: PhysicalSize {
            width: raw.width,
            height: raw.height,
        },
    }
}
