//! Display identity and topology tests.
//!
//! EM-1 prohibits unwrap/expect in *non-test* code; a test asserting a
//! precondition is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::geometry::{PhysicalPoint, PhysicalRect, PhysicalSize, ScaleFactor};
use crate::monitor::{MonitorDescriptor, MonitorId};
use crate::topology::Topology;

fn scale(value: f64) -> ScaleFactor {
    ScaleFactor::new(value).expect("test scale factor must be valid")
}

fn rect(x: i32, y: i32, w: u32, h: u32) -> PhysicalRect {
    PhysicalRect {
        origin: PhysicalPoint { x, y },
        size: PhysicalSize {
            width: w,
            height: h,
        },
    }
}

fn monitor(path: &str, model: &str, x: i32, sf: f64, primary: bool) -> MonitorDescriptor {
    MonitorDescriptor {
        id: MonitorId::from_identity(path, "ACME", model, "SN123"),
        name: format!("{model} display"),
        bounds: rect(x, 0, 1920, 1080),
        work_area: rect(x, 0, 1920, 1040),
        scale_factor: scale(sf),
        refresh_millihertz: Some(59_940),
        is_primary: primary,
    }
}

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
fn identical_models_on_different_ports_do_not_collide() {
    let a = MonitorId::from_identity(r"\\.\DISPLAY1", "ACME", "U2720Q", "SN1");
    let b = MonitorId::from_identity(r"\\.\DISPLAY2", "ACME", "U2720Q", "SN1");
    assert_ne!(a, b);
}

#[test]
fn fingerprint_is_stable_across_enumeration_order() {
    let a = monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true);
    let b = monitor(r"\\.\DISPLAY2", "B", 1920, 1.5, false);

    let forward = Topology::new(vec![a.clone(), b.clone()]);
    let reversed = Topology::new(vec![b, a]);

    assert_eq!(forward.fingerprint(), reversed.fingerprint());
}

#[test]
fn fingerprint_changes_when_a_monitor_is_removed() {
    let a = monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true);
    let b = monitor(r"\\.\DISPLAY2", "B", 1920, 1.5, false);

    let docked = Topology::new(vec![a.clone(), b]);
    let undocked = Topology::new(vec![a]);

    assert_ne!(docked.fingerprint(), undocked.fingerprint());
}

#[test]
fn fingerprint_changes_when_scale_changes() {
    let at_100 = Topology::new(vec![monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true)]);
    let at_150 = Topology::new(vec![monitor(r"\\.\DISPLAY1", "A", 0, 1.5, true)]);
    assert_ne!(at_100.fingerprint(), at_150.fingerprint());
}

#[test]
fn fingerprint_survives_a_refresh_rate_change() {
    // AC-MON-1.4: changing refresh must not orphan the layout the user built.
    let mut sixty = monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true);
    sixty.refresh_millihertz = Some(60_000);
    let mut one_forty_four = sixty.clone();
    one_forty_four.refresh_millihertz = Some(144_000);

    assert_eq!(
        Topology::new(vec![sixty]).fingerprint(),
        Topology::new(vec![one_forty_four]).fingerprint()
    );
}

#[test]
fn fingerprint_survives_a_display_rename() {
    let mut named = monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true);
    let mut renamed = named.clone();
    named.name = "Left".to_owned();
    renamed.name = "Right".to_owned();

    assert_eq!(
        Topology::new(vec![named]).fingerprint(),
        Topology::new(vec![renamed]).fingerprint()
    );
}

#[test]
fn mixed_dpi_is_detected() {
    let uniform = Topology::new(vec![
        monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true),
        monitor(r"\\.\DISPLAY2", "B", 1920, 1.0, false),
    ]);
    let mixed = Topology::new(vec![
        monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true),
        monitor(r"\\.\DISPLAY2", "B", 1920, 1.5, false),
    ]);

    assert!(!uniform.is_mixed_dpi());
    assert!(mixed.is_mixed_dpi());
}

#[test]
fn work_area_is_smaller_than_bounds_where_chrome_exists() {
    let m = monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true);
    assert!(m.work_area.size.height < m.bounds.size.height);
}

#[test]
fn primary_is_found_and_absent_when_none_reported() {
    let with_primary = Topology::new(vec![monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true)]);
    let without = Topology::new(vec![monitor(r"\\.\DISPLAY1", "A", 0, 1.0, false)]);

    assert!(with_primary.primary().is_some());
    assert!(without.primary().is_none());
}

#[test]
fn frame_interval_is_refresh_relative_and_never_unbounded() {
    let mut m = monitor(r"\\.\DISPLAY1", "A", 0, 1.0, true);

    m.refresh_millihertz = Some(144_000);
    assert!((m.frame_interval_ms() - 6.944).abs() < 0.01);

    m.refresh_millihertz = Some(59_940);
    assert!((m.frame_interval_ms() - 16.683).abs() < 0.01);

    // A platform that reports nothing must not yield an unbounded budget.
    m.refresh_millihertz = None;
    assert!((m.frame_interval_ms() - 16.666).abs() < 0.01);
}

#[test]
fn rect_contains_respects_exclusive_upper_bound() {
    let r = rect(0, 0, 1920, 1080);
    assert!(r.contains(PhysicalPoint { x: 0, y: 0 }));
    assert!(r.contains(PhysicalPoint { x: 1919, y: 1079 }));
    assert!(!r.contains(PhysicalPoint { x: 1920, y: 0 }));
}
