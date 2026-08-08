//! The three coordinate spaces.
//!
//! Confusing these is the most common defect class in multi-monitor code
//! (`AP-6`). It presents as "works on my monitor": correct on a single 100%
//! display, and off-screen or half-size the moment a second display has a
//! different scale factor.
//!
//! | Space | Unit | Origin |
//! | --- | --- | --- |
//! | **Physical** | Device pixels | Desktop origin, OS-defined |
//! | **Logical** | Device-independent pixels | Same as physical |
//! | **Surface-local** | CSS pixels | The surface's own top-left |
//!
//! WD-1: every geometry type is newtype-tagged with its space, so mixing them is
//! a compile error rather than a runtime surprise. There is no `From` between
//! spaces and no arithmetic across them.
//!
//! WD-2: conversion **requires a monitor**. The methods live on
//! [`MonitorDescriptor`](crate::monitor::MonitorDescriptor), and the
//! scale-taking functions here are crate-private, so a consumer cannot convert
//! without saying which display it means. A global scale factor does not exist
//! on a mixed-DPI desktop, and any API implying one is a defect.
//!
//! Physical coordinates are integers and logical ones are not, deliberately.
//! Device pixels are countable; DIPs at 150% are not — 1920 physical is exactly
//! 1280 logical, but 1921 is 1280.666…, and rounding that at every step
//! accumulates the drift that puts a surface one pixel off its own edge.

use serde::{Deserialize, Serialize};

/// A per-monitor scale factor, e.g. `1.5` for a display at 150%.
///
/// Never global: two monitors attached at once routinely disagree.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScaleFactor(f64);

impl ScaleFactor {
    /// Creates a scale factor.
    ///
    /// Returns `None` for a non-finite or non-positive value: a zero or NaN
    /// scale silently produces infinite or absent geometry, and the failure
    /// appears far from its cause.
    #[must_use]
    pub fn new(value: f64) -> Option<Self> {
        if value.is_finite() && value > 0.0 {
            Some(Self(value))
        } else {
            None
        }
    }

    /// The underlying ratio.
    #[must_use]
    pub const fn get(self) -> f64 {
        self.0
    }
}

/// A point in device pixels, relative to the OS-defined desktop origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicalPoint {
    pub x: i32,
    pub y: i32,
}

/// A size in device pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicalSize {
    pub width: u32,
    pub height: u32,
}

/// A rectangle in device pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicalRect {
    pub origin: PhysicalPoint,
    pub size: PhysicalSize,
}

/// A point in device-independent pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalPoint {
    pub x: f64,
    pub y: f64,
}

/// A size in device-independent pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalSize {
    pub width: f64,
    pub height: f64,
}

/// A rectangle in device-independent pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalRect {
    pub origin: LogicalPoint,
    pub size: LogicalSize,
}

/// A point in CSS pixels, relative to a surface's own top-left.
///
/// This is the space everything inside a webview works in. It exists as a
/// separate type because a surface's contents have no way to know where the
/// surface sits, and code that treats a click at (0, 0) inside a surface as the
/// desktop origin is the single most common form of `AP-6`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SurfaceLocalPoint {
    pub x: f64,
    pub y: f64,
}

/// A size in CSS pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SurfaceLocalSize {
    pub width: f64,
    pub height: f64,
}

/// A rectangle in CSS pixels, relative to a surface's own top-left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SurfaceLocalRect {
    pub origin: SurfaceLocalPoint,
    pub size: SurfaceLocalSize,
}

/// Where a surface sits, in logical coordinates.
///
/// Required to move between logical and surface-local, for the same reason a
/// monitor is required to move between physical and logical: the offset is
/// per-surface, and an API that implied a single one would be wrong the moment a
/// second surface existed.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SurfaceOrigin(LogicalPoint);

impl SurfaceOrigin {
    #[must_use]
    pub const fn new(origin: LogicalPoint) -> Self {
        Self(origin)
    }

    /// The surface's position, in logical coordinates.
    #[must_use]
    pub const fn logical(self) -> LogicalPoint {
        self.0
    }

    /// Converts a logical point into this surface's own space.
    #[must_use]
    pub fn to_surface_local(self, point: LogicalPoint) -> SurfaceLocalPoint {
        SurfaceLocalPoint {
            x: point.x - self.0.x,
            y: point.y - self.0.y,
        }
    }

    /// Converts a point in this surface's own space back to logical.
    #[must_use]
    pub fn to_logical(self, point: SurfaceLocalPoint) -> LogicalPoint {
        LogicalPoint {
            x: point.x + self.0.x,
            y: point.y + self.0.y,
        }
    }
}

impl PhysicalRect {
    /// Whether a point lies within this rectangle.
    ///
    /// The upper bound is exclusive: a display at x = 0 with width 1920 does not
    /// contain x = 1920, which is the first pixel of the display beside it.
    /// Inclusive bounds put every point on a shared edge on two monitors.
    #[must_use]
    pub const fn contains(&self, point: PhysicalPoint) -> bool {
        point.x >= self.origin.x
            && point.y >= self.origin.y
            && point.x < self.right()
            && point.y < self.bottom()
    }

    /// The x coordinate one pixel past the right edge.
    #[must_use]
    pub const fn right(&self) -> i32 {
        self.origin.x.saturating_add(self.size.width as i32)
    }

    /// The y coordinate one pixel past the bottom edge.
    #[must_use]
    pub const fn bottom(&self) -> i32 {
        self.origin.y.saturating_add(self.size.height as i32)
    }

    /// Whether two rectangles share any area.
    ///
    /// Touching edges do not intersect, matching [`PhysicalRect::contains`]:
    /// two monitors side by side overlap in no pixel.
    #[must_use]
    pub const fn intersects(&self, other: &Self) -> bool {
        self.origin.x < other.right()
            && other.origin.x < self.right()
            && self.origin.y < other.bottom()
            && other.origin.y < self.bottom()
    }

    /// Whether this rectangle contains another entirely.
    #[must_use]
    pub const fn contains_rect(&self, other: &Self) -> bool {
        other.origin.x >= self.origin.x
            && other.origin.y >= self.origin.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }

    /// The smallest rectangle containing both.
    #[must_use]
    pub fn union(&self, other: &Self) -> Self {
        let left = self.origin.x.min(other.origin.x);
        let top = self.origin.y.min(other.origin.y);
        let right = self.right().max(other.right());
        let bottom = self.bottom().max(other.bottom());

        Self {
            origin: PhysicalPoint { x: left, y: top },
            size: PhysicalSize {
                width: right.saturating_sub(left).unsigned_abs(),
                height: bottom.saturating_sub(top).unsigned_abs(),
            },
        }
    }

    /// The centre point, rounded toward the origin.
    #[must_use]
    pub const fn center(&self) -> PhysicalPoint {
        PhysicalPoint {
            x: self.origin.x.saturating_add(self.size.width as i32 / 2),
            y: self.origin.y.saturating_add(self.size.height as i32 / 2),
        }
    }
}

impl LogicalRect {
    /// Whether a point lies within this rectangle.
    #[must_use]
    pub fn contains(&self, point: LogicalPoint) -> bool {
        point.x >= self.origin.x
            && point.y >= self.origin.y
            && point.x < self.origin.x + self.size.width
            && point.y < self.origin.y + self.size.height
    }
}

// Conversions are crate-private on purpose (WD-2). The public way to convert is
// through a `MonitorDescriptor`, which is what forces a caller to say which
// display it means on a desktop where the answer differs per display.
impl PhysicalPoint {
    pub(crate) fn to_logical(self, scale: ScaleFactor) -> LogicalPoint {
        LogicalPoint {
            x: f64::from(self.x) / scale.get(),
            y: f64::from(self.y) / scale.get(),
        }
    }
}

impl PhysicalSize {
    pub(crate) fn to_logical(self, scale: ScaleFactor) -> LogicalSize {
        LogicalSize {
            width: f64::from(self.width) / scale.get(),
            height: f64::from(self.height) / scale.get(),
        }
    }
}

impl LogicalPoint {
    pub(crate) fn to_physical(self, scale: ScaleFactor) -> PhysicalPoint {
        PhysicalPoint {
            x: to_device_pixels(self.x * scale.get()),
            y: to_device_pixels(self.y * scale.get()),
        }
    }
}

impl LogicalSize {
    pub(crate) fn to_physical(self, scale: ScaleFactor) -> PhysicalSize {
        PhysicalSize {
            width: to_device_extent(self.width * scale.get()),
            height: to_device_extent(self.height * scale.get()),
        }
    }
}

/// Rounds a logical coordinate to a device pixel, clamped to the addressable range.
///
/// Clamped rather than wrapped: a coordinate beyond `i32` is a defect upstream,
/// and a wrapped one moves a surface to the opposite corner of the desktop
/// instead of to the edge, which is much harder to recognise as the same bug.
fn to_device_pixels(value: f64) -> i32 {
    if value.is_nan() {
        return 0;
    }
    let rounded = value.round();
    if rounded <= f64::from(i32::MIN) {
        i32::MIN
    } else if rounded >= f64::from(i32::MAX) {
        i32::MAX
    } else {
        rounded as i32
    }
}

/// Rounds a logical extent to a device-pixel count.
fn to_device_extent(value: f64) -> u32 {
    if value.is_nan() || value <= 0.0 {
        return 0;
    }
    let rounded = value.round();
    if rounded >= f64::from(u32::MAX) {
        u32::MAX
    } else {
        rounded as u32
    }
}
