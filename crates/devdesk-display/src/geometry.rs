//! Coordinate spaces.
//!
//! Confusing these is the most common defect class in multi-monitor code
//! (AP-6). It presents as "works on my monitor": correct on a single 100%
//! display, and off-screen or half-size the moment a second display has a
//! different scale factor.
//!
//! WD-1: every geometry type is newtype-tagged with its space, so mixing them is
//! a compile error rather than a runtime surprise.
//!
//! WD-2: conversion **requires** a monitor. A global scale factor does not exist
//! on a mixed-DPI desktop, so any API implying one is a defect. That is why no
//! `to_logical()` here takes a bare number.

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

/// A point in device-independent pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalPoint {
    pub x: f64,
    pub y: f64,
}

/// A size in device pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicalSize {
    pub width: u32,
    pub height: u32,
}

/// A size in device-independent pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LogicalSize {
    pub width: f64,
    pub height: f64,
}

/// A rectangle in device pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhysicalRect {
    pub origin: PhysicalPoint,
    pub size: PhysicalSize,
}

impl PhysicalRect {
    /// Whether a point lies within this rectangle.
    #[must_use]
    pub const fn contains(&self, point: PhysicalPoint) -> bool {
        point.x >= self.origin.x
            && point.y >= self.origin.y
            && point.x < self.origin.x.saturating_add(self.size.width as i32)
            && point.y < self.origin.y.saturating_add(self.size.height as i32)
    }
}

impl PhysicalPoint {
    /// Converts to logical coordinates for a specific monitor.
    ///
    /// WD-2: takes a scale factor obtained from a monitor, never a global one.
    #[must_use]
    pub fn to_logical(self, scale: ScaleFactor) -> LogicalPoint {
        LogicalPoint {
            x: f64::from(self.x) / scale.get(),
            y: f64::from(self.y) / scale.get(),
        }
    }
}

impl PhysicalSize {
    /// Converts to logical dimensions for a specific monitor.
    #[must_use]
    pub fn to_logical(self, scale: ScaleFactor) -> LogicalSize {
        LogicalSize {
            width: f64::from(self.width) / scale.get(),
            height: f64::from(self.height) / scale.get(),
        }
    }
}

impl LogicalPoint {
    /// Converts to device pixels for a specific monitor.
    #[must_use]
    pub fn to_physical(self, scale: ScaleFactor) -> PhysicalPoint {
        PhysicalPoint {
            #[allow(clippy::cast_possible_truncation)]
            x: (self.x * scale.get()).round() as i32,
            #[allow(clippy::cast_possible_truncation)]
            y: (self.y * scale.get()).round() as i32,
        }
    }
}
