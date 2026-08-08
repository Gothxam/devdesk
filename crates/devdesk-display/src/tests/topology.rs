//! Arrangement identity.

use crate::topology::Topology;

use super::fixtures::identified;

#[test]
fn fingerprint_is_stable_across_enumeration_order() {
    let a = identified(0, "SN-A").build();
    let b = identified(1, "SN-B").bounds(1920, 0, 1920, 1080).build();

    let forward = Topology::new(vec![a.clone(), b.clone()]);
    let reversed = Topology::new(vec![b, a]);

    assert_eq!(forward.fingerprint(), reversed.fingerprint());
}

#[test]
fn fingerprint_changes_when_a_monitor_is_removed() {
    let a = identified(0, "SN-A").build();
    let b = identified(1, "SN-B").bounds(1920, 0, 1920, 1080).build();

    let docked = Topology::new(vec![a.clone(), b]);
    let undocked = Topology::new(vec![a]);

    assert_ne!(docked.fingerprint(), undocked.fingerprint());
}

#[test]
fn fingerprint_changes_when_scale_changes() {
    let at_100 = Topology::new(vec![identified(0, "SN-A").dpi(96).build()]);
    let at_150 = Topology::new(vec![identified(0, "SN-A").dpi(144).build()]);
    assert_ne!(at_100.fingerprint(), at_150.fingerprint());
}

#[test]
fn fingerprint_survives_a_refresh_rate_change() {
    // AC-MON-1.4: changing refresh must not orphan the layout the user built.
    let sixty = identified(0, "SN-A")
        .refresh_millihertz(Some(60_000))
        .build();
    let one_forty_four = identified(0, "SN-A")
        .refresh_millihertz(Some(144_000))
        .build();

    assert_eq!(
        Topology::new(vec![sixty]).fingerprint(),
        Topology::new(vec![one_forty_four]).fingerprint()
    );
}

#[test]
fn fingerprint_survives_a_display_rename() {
    let named = identified(0, "SN-A").name("Left").build();
    let renamed = identified(0, "SN-A").name("Right").build();

    assert_eq!(
        Topology::new(vec![named]).fingerprint(),
        Topology::new(vec![renamed]).fingerprint()
    );
}

#[test]
fn fingerprint_is_pinned_so_a_change_to_it_is_deliberate() {
    // The fingerprint is persisted (WD-4). Changing how it is computed orphans
    // every saved arrangement, so it is asserted against a literal: the failure
    // shows up here, in a diff, rather than as a user's lost layout.
    let topology = Topology::new(vec![identified(0, "SN-A").build()]);
    assert_eq!(topology.fingerprint().as_str(), "8ead65ebca65af92");
}

#[test]
fn mixed_dpi_is_detected() {
    let uniform = Topology::new(vec![
        identified(0, "SN-A").dpi(96).build(),
        identified(1, "SN-B")
            .dpi(96)
            .bounds(1920, 0, 1920, 1080)
            .build(),
    ]);
    let mixed = Topology::new(vec![
        identified(0, "SN-A").dpi(96).build(),
        identified(1, "SN-B")
            .dpi(144)
            .bounds(1920, 0, 1920, 1080)
            .build(),
    ]);

    assert!(!uniform.is_mixed_dpi());
    assert!(mixed.is_mixed_dpi());
}

#[test]
fn work_area_is_smaller_than_bounds_where_chrome_exists() {
    let monitor = identified(0, "SN-A").build();
    assert!(monitor.work_area.size.height < monitor.bounds.size.height);
}

#[test]
fn primary_is_found_and_absent_when_none_reported() {
    let with_primary = Topology::new(vec![identified(0, "SN-A").primary(true).build()]);
    let without = Topology::new(vec![identified(0, "SN-A").primary(false).build()]);

    assert!(with_primary.primary().is_some());
    assert!(without.primary().is_none());
}

#[test]
fn frame_interval_is_refresh_relative_and_never_unbounded() {
    let at_144 = identified(0, "SN-A")
        .refresh_millihertz(Some(144_000))
        .build();
    assert!((at_144.frame_interval_ms() - 6.944).abs() < 0.01);

    let at_5994 = identified(0, "SN-A")
        .refresh_millihertz(Some(59_940))
        .build();
    assert!((at_5994.frame_interval_ms() - 16.683).abs() < 0.01);

    // A platform that reports nothing must not yield an unbounded budget.
    let unreported = identified(0, "SN-A").refresh_millihertz(None).build();
    assert!((unreported.frame_interval_ms() - 16.666).abs() < 0.01);
}

#[test]
fn a_monitor_is_found_by_identity() {
    let a = identified(0, "SN-A").build();
    let b = identified(1, "SN-B").bounds(1920, 0, 1920, 1080).build();
    let topology = Topology::new(vec![a.clone(), b]);

    assert!(topology.find(a.id()).is_some());
    assert_eq!(topology.len(), 2);
    assert!(!topology.is_empty());
}

#[test]
fn no_displays_attached_is_a_state_not_an_error() {
    // A laptop with the lid closed and nothing plugged in reports exactly this.
    let none = Topology::new(vec![]);
    assert!(none.is_empty());
    assert!(none.primary().is_none());
    assert!(!none.is_mixed_dpi());
}
