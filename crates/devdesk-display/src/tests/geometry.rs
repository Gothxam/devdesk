//! Coordinate spaces.

use crate::geometry::{PhysicalPoint, ScaleFactor};

use super::fixtures::{rect, scale};

#[test]
fn scale_factor_rejects_values_that_would_produce_absent_geometry() {
    assert!(ScaleFactor::new(0.0).is_none());
    assert!(ScaleFactor::new(-1.0).is_none());
    assert!(ScaleFactor::new(f64::NAN).is_none());
    assert!(ScaleFactor::new(f64::INFINITY).is_none());
    assert!(ScaleFactor::new(1.5).is_some());
}

#[test]
fn conversion_round_trips_within_tolerance() {
    let sf = scale(1.5);
    let original = PhysicalPoint { x: 300, y: 450 };
    let back = original.to_logical(sf).to_physical(sf);
    assert_eq!(original, back);
}

#[test]
fn conversion_differs_per_monitor_because_scale_is_not_global() {
    let point = PhysicalPoint { x: 300, y: 300 };
    let at_100 = point.to_logical(scale(1.0));
    let at_150 = point.to_logical(scale(1.5));
    assert!((at_100.x - 300.0).abs() < f64::EPSILON);
    assert!((at_150.x - 200.0).abs() < f64::EPSILON);
}

#[test]
fn rect_contains_respects_exclusive_upper_bound() {
    let r = rect(0, 0, 1920, 1080);
    assert!(r.contains(PhysicalPoint { x: 0, y: 0 }));
    assert!(r.contains(PhysicalPoint { x: 1919, y: 1079 }));
    assert!(!r.contains(PhysicalPoint { x: 1920, y: 0 }));
}
