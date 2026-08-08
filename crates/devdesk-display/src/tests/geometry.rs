//! Coordinate spaces.

use crate::geometry::{
    LogicalPoint, LogicalRect, LogicalSize, PhysicalPoint, PhysicalSize, ScaleFactor, SurfaceOrigin,
};

use super::fixtures::{identified, rect};

fn close(left: f64, right: f64) -> bool {
    (left - right).abs() < 1e-9
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
fn conversion_round_trips_through_a_monitor() {
    let monitor = identified(0, "SN-A").dpi(144).build();
    let original = PhysicalPoint { x: 300, y: 450 };

    let back = monitor.to_physical_point(monitor.to_logical_point(original));

    assert_eq!(original, back);
}

#[test]
fn the_same_point_converts_differently_on_two_displays() {
    // PS-4: mixed DPI is the assumed case. A conversion that did not require a
    // monitor would have to pick one of these answers and be wrong on the other.
    let at_100 = identified(0, "SN-A").dpi(96).build();
    let at_150 = identified(1, "SN-B").dpi(144).build();
    let point = PhysicalPoint { x: 300, y: 300 };

    assert!(close(at_100.to_logical_point(point).x, 300.0));
    assert!(close(at_150.to_logical_point(point).x, 200.0));
}

#[test]
fn a_size_converts_with_the_monitor_it_is_on() {
    let monitor = identified(0, "SN-A").dpi(192).build();
    let logical = monitor.to_logical_size(PhysicalSize {
        width: 800,
        height: 600,
    });

    assert!(close(logical.width, 400.0));
    assert!(close(logical.height, 300.0));

    let physical = monitor.to_physical_size(logical);
    assert_eq!(physical.width, 800);
    assert_eq!(physical.height, 600);
}

#[test]
fn logical_bounds_and_work_area_come_from_the_monitors_own_scale() {
    let monitor = identified(0, "SN-A")
        .dpi(144)
        .bounds(0, 0, 3840, 2160)
        .build();

    let bounds = monitor.logical_bounds();
    assert!(close(bounds.size.width, 2560.0));
    assert!(close(bounds.size.height, 1440.0));

    // The work area is shorter than the bounds, and stays shorter after
    // conversion — a surface anchored to the bottom of `bounds` sits under the
    // taskbar in either space.
    assert!(monitor.logical_work_area().size.height < bounds.size.height);
}

#[test]
fn surface_local_coordinates_are_relative_to_the_surface() {
    // A click at (0, 0) inside a surface is not the desktop origin. Treating it
    // as one is the single most common form of AP-6.
    let origin = SurfaceOrigin::new(LogicalPoint { x: 640.0, y: 360.0 });
    let inside = origin.to_surface_local(LogicalPoint { x: 700.0, y: 400.0 });

    assert!(close(inside.x, 60.0));
    assert!(close(inside.y, 40.0));

    let back = origin.to_logical(inside);
    assert!(close(back.x, 700.0) && close(back.y, 400.0));
}

#[test]
fn a_surface_on_a_scaled_display_round_trips_through_all_three_spaces() {
    let monitor = identified(0, "SN-A").dpi(144).build();
    let surface = SurfaceOrigin::new(monitor.to_logical_point(PhysicalPoint { x: 300, y: 150 }));

    let physical = PhysicalPoint { x: 600, y: 450 };
    let local = surface.to_surface_local(monitor.to_logical_point(physical));

    // 600 physical is 400 logical; the surface starts at 200 logical.
    assert!(close(local.x, 200.0));
    assert!(close(local.y, 200.0));

    let back = monitor.to_physical_point(surface.to_logical(local));
    assert_eq!(back, physical);
}

#[test]
fn rect_contains_respects_exclusive_upper_bound() {
    // Inclusive bounds put every point on a shared edge on two monitors.
    let r = rect(0, 0, 1920, 1080);
    assert!(r.contains(PhysicalPoint { x: 0, y: 0 }));
    assert!(r.contains(PhysicalPoint { x: 1919, y: 1079 }));
    assert!(!r.contains(PhysicalPoint { x: 1920, y: 0 }));
}

#[test]
fn touching_rectangles_do_not_intersect() {
    let left = rect(0, 0, 1920, 1080);
    let right = rect(1920, 0, 1920, 1080);
    let overlapping = rect(1910, 0, 1920, 1080);

    assert!(
        !left.intersects(&right),
        "two monitors side by side share no pixel"
    );
    assert!(left.intersects(&overlapping));
}

#[test]
fn union_spans_both_rectangles_including_negative_origins() {
    let left = rect(-1920, 0, 1920, 1080);
    let right = rect(0, 0, 2560, 1440);
    let spanned = left.union(&right);

    assert_eq!(spanned.origin, PhysicalPoint { x: -1920, y: 0 });
    assert_eq!(spanned.size.width, 4480);
    assert_eq!(spanned.size.height, 1440);
}

#[test]
fn containment_is_not_intersection() {
    let outer = rect(0, 0, 1920, 1080);
    let inner = rect(100, 100, 200, 200);
    let straddling = rect(1800, 0, 400, 200);

    assert!(outer.contains_rect(&inner));
    assert!(!outer.contains_rect(&straddling));
    assert!(outer.intersects(&straddling));
}

#[test]
fn a_logical_rect_answers_containment_in_its_own_space() {
    let area = LogicalRect {
        origin: LogicalPoint { x: 0.0, y: 0.0 },
        size: LogicalSize {
            width: 1280.0,
            height: 720.0,
        },
    };

    assert!(area.contains(LogicalPoint {
        x: 1279.5,
        y: 719.5
    }));
    assert!(!area.contains(LogicalPoint { x: 1280.0, y: 0.0 }));
}

#[test]
fn a_coordinate_beyond_the_addressable_range_clamps_rather_than_wraps() {
    // A wrapped coordinate moves a surface to the opposite corner of the
    // desktop instead of to its edge, which is far harder to recognise as the
    // same defect.
    let monitor = identified(0, "SN-A").build();
    let far = monitor.to_physical_point(LogicalPoint { x: 1e30, y: -1e30 });

    assert_eq!(far.x, i32::MAX);
    assert_eq!(far.y, i32::MIN);
}
