//! Confidence-based identity.

use devdesk_platform::ConnectorKind;

use crate::identity::{resolve, IdentityConfidence, MonitorIdentity};
use crate::monitor::MonitorDescriptor;

use super::fixtures::{identified, Raw};

fn identity(raw: &Raw) -> MonitorIdentity {
    MonitorIdentity::from_raw(raw.raw())
}

#[test]
fn a_matching_serial_and_model_is_exact() {
    let left = identity(&identified(0, "SN-A"));
    let right = identity(&identified(0, "SN-A"));

    assert_eq!(
        left.confidence_against(&right),
        IdentityConfidence::Exact,
        "the same panel reports the same serial"
    );
}

#[test]
fn a_serial_survives_being_moved_to_another_port() {
    // The case device paths cannot cover: same panel, different cable.
    let before = identity(&identified(0, "SN-A"));
    let after = identity(
        &identified(0, "SN-A")
            .device_path(r"\\?\DISPLAY#ACM1234#5&otherport&0&UID9")
            .connector(ConnectorKind::Hdmi, 1)
            .adapter("00000000beef:3"),
    );

    assert_eq!(before.confidence_against(&after), IdentityConfidence::Exact);
}

#[test]
fn two_absent_serials_are_not_agreement() {
    // The defect this whole design exists to prevent. `None == None` is true in
    // Rust; two displays that both declined to report a serial have not matched.
    let left = identity(&Raw::new(0).device_path(r"\\?\DISPLAY#A#1").model("ACM", 1));
    let right = identity(&Raw::new(1).device_path(r"\\?\DISPLAY#B#2").model("ACM", 1));

    assert!(left.serial().is_none() && right.serial().is_none());
    assert_ne!(left.confidence_against(&right), IdentityConfidence::Exact);
}

#[test]
fn a_serial_without_a_model_cannot_be_exact() {
    // Serials are unique per manufacturer, not globally. "1" is a real serial on
    // more than one panel.
    let left = identity(&Raw::new(0).serial("1"));
    let right = identity(&Raw::new(1).serial("1"));

    assert_ne!(left.confidence_against(&right), IdentityConfidence::Exact);
}

#[test]
fn a_matching_device_path_is_strong() {
    let path = r"\\?\DISPLAY#ACM1234#5&aa&0&UID1";
    let left = identity(&Raw::new(0).device_path(path));
    let right = identity(&Raw::new(1).device_path(path).bounds(1920, 0, 2560, 1440));

    assert_eq!(left.confidence_against(&right), IdentityConfidence::Strong);
}

#[test]
fn the_same_model_on_the_same_port_is_probable_not_strong() {
    // Two identical panels swapped between sessions look exactly like this, so
    // the confidence must stay below the floor that reattaches silently.
    let left = identity(
        &Raw::new(0)
            .model("ACM", 0x1234)
            .connector(ConnectorKind::Hdmi, 0)
            .adapter("gpu0:0"),
    );
    let right = identity(
        &Raw::new(1)
            .model("ACM", 0x1234)
            .connector(ConnectorKind::Hdmi, 0)
            .adapter("gpu0:0"),
    );

    let confidence = left.confidence_against(&right);
    assert_eq!(confidence, IdentityConfidence::Probable);
    assert!(!confidence.is_conclusive());
}

#[test]
fn a_different_connector_breaks_a_probable_match() {
    let left = identity(
        &Raw::new(0)
            .model("ACM", 0x1234)
            .connector(ConnectorKind::Hdmi, 0)
            .adapter("gpu0:0"),
    );
    let right = identity(
        &Raw::new(0)
            .model("ACM", 0x1234)
            .connector(ConnectorKind::DisplayPort, 0)
            .adapter("gpu0:0"),
    );

    assert!(left.confidence_against(&right) < IdentityConfidence::Probable);
}

#[test]
fn a_display_reporting_nothing_still_has_a_deterministic_key() {
    // WD-5: an unknown topology resolves deterministically. That requires a key
    // even for a display with no distinctive signal at all.
    let anonymous = identity(&Raw::new(0));
    let same_again = identity(&Raw::new(0));

    assert_eq!(anonymous.id(), same_again.id());
    assert_eq!(anonymous.strength(), IdentityConfidence::Weak);
    assert_eq!(
        anonymous.confidence_against(&same_again),
        IdentityConfidence::Weak
    );
}

#[test]
fn the_fallback_ignores_position_so_rearranging_is_not_new_hardware() {
    let left = identity(&Raw::new(0).bounds(0, 0, 1920, 1080));
    let right = identity(&Raw::new(0).bounds(2560, 0, 1920, 1080));

    assert_eq!(left.fallback_hash(), right.fallback_hash());
}

#[test]
fn the_fallback_still_separates_two_anonymous_displays() {
    let left = identity(&Raw::new(0));
    let right = identity(&Raw::new(1));

    assert_ne!(left.fallback_hash(), right.fallback_hash());
    assert_eq!(
        left.confidence_against(&right),
        IdentityConfidence::None,
        "two anonymous displays are not the same display"
    );
}

#[test]
fn identity_strength_states_up_front_what_is_possible() {
    assert_eq!(
        identity(&identified(0, "SN-A")).strength(),
        IdentityConfidence::Exact
    );
    assert_eq!(
        identity(&Raw::new(0).device_path(r"\\?\DISPLAY#A#1")).strength(),
        IdentityConfidence::Strong
    );
    assert_eq!(
        identity(
            &Raw::new(0)
                .model("ACM", 1)
                .connector(ConnectorKind::Hdmi, 0)
        )
        .strength(),
        IdentityConfidence::Probable
    );
    assert_eq!(identity(&Raw::new(0)).strength(), IdentityConfidence::Weak);
}

#[test]
fn the_key_is_derived_from_the_strongest_signal_present() {
    let unit = identity(&identified(0, "SN-A"));
    assert!(unit.id().as_str().starts_with("unit:"));

    let port = identity(&Raw::new(0).device_path(r"\\?\DISPLAY#A#1"));
    assert!(port.id().as_str().starts_with("port:"));

    let weak = identity(&Raw::new(0));
    assert!(weak.id().as_str().starts_with("weak:"));
}

#[test]
fn a_serial_derived_key_cannot_collide_with_a_path_derived_one() {
    let unit = identity(&identified(0, "SN-A"));
    let port = identity(&Raw::new(0).device_path("unit:ACM-1234:SN-A"));

    assert_ne!(unit.id(), port.id());
}

#[test]
fn resolution_picks_the_strongest_candidate() {
    let known = vec![
        identity(
            &Raw::new(0)
                .model("ACM", 1)
                .connector(ConnectorKind::Hdmi, 0),
        ),
        identity(&identified(1, "SN-B")),
    ];

    let candidate = identity(&identified(1, "SN-B"));
    let found = resolve(&known, &candidate).expect("an exact match exists");

    assert_eq!(found.index, 1);
    assert_eq!(found.confidence, IdentityConfidence::Exact);
}

#[test]
fn an_ambiguous_match_resolves_to_nothing() {
    // Two identical panels on two identical-looking ports. Picking one binds a
    // layout to the wrong display about half the time, which is a silent
    // arrangement change — AC-DAT-1.1 has no acceptable nonzero rate for it.
    let twin = |index: u32| {
        identity(
            &Raw::new(index)
                .model("ACM", 0x1234)
                .connector(ConnectorKind::Hdmi, 0)
                .adapter("gpu0:0")
                .enumeration_index(0),
        )
    };

    let known = vec![twin(0), twin(1)];
    let candidate = twin(2);

    assert_eq!(
        known[0].confidence_against(&candidate),
        IdentityConfidence::Probable
    );
    assert!(
        resolve(&known, &candidate).is_none(),
        "a tie must not be resolved by enumeration order"
    );
}

#[test]
fn nothing_matching_resolves_to_nothing() {
    let known = vec![identity(&identified(0, "SN-A"))];
    let candidate = identity(&identified(1, "SN-Z").device_path(r"\\?\DISPLAY#Z#9"));

    assert!(resolve(&known, &candidate).is_none());
}

#[test]
fn an_unusable_display_is_rejected_with_the_field_that_was_wrong() {
    let zero_area = Raw::new(0).bounds(0, 0, 0, 0);
    let error = MonitorDescriptor::from_raw(zero_area.raw()).expect_err("zero area is unusable");
    assert!(format!("{error}").contains("bounds"));

    let no_dpi = Raw::new(0).dpi(0);
    let error = MonitorDescriptor::from_raw(no_dpi.raw()).expect_err("zero dpi is unusable");
    assert!(format!("{error}").contains("scale factor"));
}

#[test]
fn dpi_becomes_a_per_monitor_scale_factor() {
    assert!((Raw::new(0).dpi(96).build().scale_factor.get() - 1.0).abs() < f64::EPSILON);
    assert!((Raw::new(0).dpi(144).build().scale_factor.get() - 1.5).abs() < f64::EPSILON);
    assert!((Raw::new(0).dpi(192).build().scale_factor.get() - 2.0).abs() < f64::EPSILON);
}

#[test]
fn a_missing_work_area_falls_back_to_full_bounds() {
    // Costs a surface being placed under the taskbar. Treating the display as
    // unusable would cost the user a monitor.
    let mut raw = Raw::new(0).raw().clone();
    raw.work_area.width = 0;
    raw.work_area.height = 0;

    let monitor = MonitorDescriptor::from_raw(&raw).expect("still usable");
    assert_eq!(monitor.work_area.size, monitor.bounds.size);
}
