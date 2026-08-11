//! Desktop host planning and recovery.
//!
//! `TS-6`: no wall clock. Every instant is a parameter, so the debounce is
//! asserted by advancing a number rather than by sleeping.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use devdesk_display::{DisplayGraph, MonitorDescriptor, Topology};
use devdesk_platform::{Connector, ConnectorKind, RawMonitorInfo, RawRect};

use super::{
    DesktopMode, HostPlan, HostWindowChange, HostWindowId, ModeRequest, ReattachTrigger,
    RecoveryClock, RecoveryState, MAX_ATTEMPTS,
};

/// One display, built the way production builds one.
///
/// Through `MonitorDescriptor::from_raw`, so identity and scale are resolved by
/// the crate under test rather than asserted by the fixture — the same reason
/// the window suite's fixtures do it.
fn monitor(serial: &str, x: i32, width: u32, height: u32, dpi: u32) -> MonitorDescriptor {
    let index = x.unsigned_abs() / 1_000;

    let raw = RawMonitorInfo {
        device_path: Some(format!(r"\\?\DISPLAY#ACM1234#5&port{index}&0&UID{index}")),
        adapter: Some(format!("00000000dead:{index}")),
        serial: Some(serial.to_owned()),
        connector: Some(Connector {
            kind: ConnectorKind::DisplayPort,
            instance: index,
        }),
        manufacturer: Some("ACM".to_owned()),
        product_code: Some(0x1234),
        friendly_name: Some(format!("ACME {serial}")),
        os_device_name: Some(format!(r"\\.\DISPLAY{}", index + 1)),
        bounds: RawRect {
            x,
            y: 0,
            width,
            height,
        },
        work_area: RawRect {
            x,
            y: 0,
            width,
            height: height.saturating_sub(40),
        },
        dpi,
        refresh_millihertz: Some(59_940),
        is_primary: x == 0,
        os_enumeration_index: index,
    };

    MonitorDescriptor::from_raw(&raw).expect("the fixture must describe a usable display")
}

/// The id the planner derives for a fixture monitor.
fn id_of(descriptor: &MonitorDescriptor) -> HostWindowId {
    HostWindowId::for_monitor(descriptor.identity.id().clone())
}

fn graph(monitors: Vec<MonitorDescriptor>) -> Arc<DisplayGraph> {
    DisplayGraph::build(Arc::new(Topology::new(monitors)))
}

// ------------------------------------------------------------------ plan --

#[test]
fn one_host_window_per_monitor() {
    // DH-13. Not one window spanning the virtual desktop: per-monitor DPI makes
    // a spanning window wrong on a mixed-DPI desk.
    let primary = monitor("SN-PRIMARY", 0, 2560, 1440, 96);
    let left = monitor("SN-LEFT", -1920, 1920, 1080, 120);

    let plan = HostPlan::for_graph(&graph(vec![primary, left.clone()]));

    assert_eq!(plan.len(), 2);

    let hosted = plan
        .get(&id_of(&left))
        .expect("the left monitor must have a host window");

    // DH-14: a monitor left of the primary has a negative origin, and that is
    // where it is — not something to clamp to zero.
    assert_eq!(hosted.bounds.origin.x, -1920);
    assert!((hosted.scale_factor - 1.25).abs() < f64::EPSILON);
    assert!(!hosted.is_primary);
}

#[test]
fn a_host_window_covers_the_whole_monitor_not_the_work_area() {
    // The wallpaper covers the whole monitor and the taskbar sits in front of
    // it. Using the work area would leave a strip the widgets could never reach
    // even when the taskbar auto-hides.
    let descriptor = monitor("SN-PRIMARY", 0, 1920, 1080, 96);
    let plan = HostPlan::for_graph(&graph(vec![descriptor.clone()]));

    let window = plan.windows().next().unwrap();

    assert_eq!(window.bounds, descriptor.bounds);
    assert_ne!(window.bounds, descriptor.work_area);
}

#[test]
fn a_machine_with_no_displays_plans_no_windows() {
    // A closed lid with nothing external attached. Zero windows is the honest
    // answer; one window somewhere invented is not.
    let plan = HostPlan::for_graph(&graph(vec![]));

    assert!(plan.is_empty());
    assert_eq!(plan.changes_to(&HostPlan::empty()), vec![]);
}

#[test]
fn an_unchanged_monitor_produces_no_change() {
    // The point of the diff. Replugging a second monitor must not tear down and
    // rebuild the first one's desktop — the user would see a flash on a display
    // nothing happened to (AC-FRE-1.1).
    let primary = monitor("SN-PRIMARY", 0, 1920, 1080, 96);
    let second = monitor("SN-SECOND", 1920, 1920, 1080, 96);

    let before = HostPlan::for_graph(&graph(vec![primary.clone()]));
    let after = HostPlan::for_graph(&graph(vec![primary, second.clone()]));

    let changes = before.changes_to(&after);

    assert_eq!(
        changes.len(),
        1,
        "only the new monitor changes: {changes:?}"
    );
    assert_eq!(
        changes[0],
        HostWindowChange::Create(after.get(&id_of(&second)).unwrap().clone())
    );
}

#[test]
fn unplugging_destroys_exactly_that_monitors_window() {
    let primary = monitor("SN-PRIMARY", 0, 1920, 1080, 96);
    let second = monitor("SN-SECOND", 1920, 1920, 1080, 96);

    let before = HostPlan::for_graph(&graph(vec![primary.clone(), second.clone()]));
    let after = HostPlan::for_graph(&graph(vec![primary]));

    assert_eq!(
        before.changes_to(&after),
        vec![HostWindowChange::Destroy(id_of(&second))]
    );
}

#[test]
fn a_resolution_change_moves_rather_than_recreates() {
    // Destroying and recreating would take the webview with it, and the desktop
    // would go blank and repaint for a change that only needs a resize.
    let before = HostPlan::for_graph(&graph(vec![monitor("SN-PRIMARY", 0, 1920, 1080, 96)]));
    let after = HostPlan::for_graph(&graph(vec![monitor("SN-PRIMARY", 0, 2560, 1440, 96)]));

    let changes = before.changes_to(&after);

    assert_eq!(changes.len(), 1);
    assert!(matches!(&changes[0], HostWindowChange::Move(window)
        if window.bounds.size.width == 2560));
}

#[test]
fn a_scale_change_alone_still_moves() {
    // WD-2: a display whose scale changed but whose pixels did not still needs
    // the host window told, because the webview inside lays out in logical
    // pixels and would otherwise keep the old factor.
    let before = HostPlan::for_graph(&graph(vec![monitor("SN-PRIMARY", 0, 1920, 1080, 96)]));
    let after = HostPlan::for_graph(&graph(vec![monitor("SN-PRIMARY", 0, 1920, 1080, 144)]));

    assert!(matches!(
        before.changes_to(&after).as_slice(),
        [HostWindowChange::Move(_)]
    ));
}

#[test]
fn a_window_never_appears_in_two_changes() {
    let before = HostPlan::for_graph(&graph(vec![
        monitor("SN-PRIMARY", 0, 1920, 1080, 96),
        monitor("SN-GONE", 1920, 1920, 1080, 96),
    ]));
    let after = HostPlan::for_graph(&graph(vec![
        monitor("SN-PRIMARY", 0, 2560, 1440, 96),
        monitor("SN-NEW", 2560, 1920, 1080, 96),
    ]));

    let mut touched: Vec<String> = before
        .changes_to(&after)
        .iter()
        .map(|change| match change {
            HostWindowChange::Create(window) | HostWindowChange::Move(window) => {
                window.id.to_string()
            }
            HostWindowChange::Destroy(id) => id.to_string(),
        })
        .collect();

    let count = touched.len();
    touched.sort_unstable();
    touched.dedup();

    assert_eq!(touched.len(), count, "a window was named twice");
}

#[test]
fn planning_is_stable_across_calls() {
    // The same topology must produce the same plan in the same order, or a
    // diff against it would report phantom changes on every enumeration.
    let displays = graph(vec![
        monitor("SN-B", 1920, 1920, 1080, 96),
        monitor("SN-A", 0, 1920, 1080, 96),
    ]);

    assert_eq!(
        HostPlan::for_graph(&displays),
        HostPlan::for_graph(&displays)
    );
    assert_eq!(
        HostPlan::for_graph(&displays).changes_to(&HostPlan::for_graph(&displays)),
        vec![]
    );
}

// -------------------------------------------------------------- recovery --

#[test]
fn nothing_pending_asks_for_nothing() {
    let state = RecoveryState::new();

    assert_eq!(state.poll(RecoveryClock(10_000)), ReattachTrigger::Wait);
    assert!(!state.is_pending());
}

#[test]
fn a_restart_waits_out_the_debounce_before_reattaching() {
    // DH-12: the same WD-6 250 ms window as hotplug.
    let mut state = RecoveryState::new();
    state.hint(RecoveryClock(1_000));

    assert_eq!(state.poll(RecoveryClock(1_000)), ReattachTrigger::Wait);
    assert_eq!(state.poll(RecoveryClock(1_249)), ReattachTrigger::Wait);
    assert_eq!(state.poll(RecoveryClock(1_250)), ReattachTrigger::Reattach);
}

#[test]
fn a_burst_of_hints_reattaches_once() {
    // Explorer emits TaskbarCreated more than once during a restart on some
    // builds. Re-running attachment for each would rebuild the desktop twice.
    let mut state = RecoveryState::new();

    state.hint(RecoveryClock(1_000));
    state.hint(RecoveryClock(1_100));
    state.hint(RecoveryClock(1_200));

    // The window restarts from the *last* hint, not the first: the last event
    // in a burst is the one whose state is real.
    assert_eq!(state.poll(RecoveryClock(1_300)), ReattachTrigger::Wait);
    assert_eq!(state.poll(RecoveryClock(1_450)), ReattachTrigger::Reattach);

    state.attempted(RecoveryClock(1_450), true);
    assert_eq!(state.poll(RecoveryClock(9_999)), ReattachTrigger::Wait);
}

#[test]
fn a_successful_reattach_returns_to_rest() {
    let mut state = RecoveryState::new();
    state.hint(RecoveryClock(0));
    state.attempted(RecoveryClock(250), true);

    assert!(!state.is_pending());
    assert_eq!(state.attempts(), 0);
    assert_eq!(state.poll(RecoveryClock(1_000)), ReattachTrigger::Wait);
}

#[test]
fn a_failed_reattach_waits_another_debounce_rather_than_spinning() {
    // DH-12 prohibits retrying indefinitely, and a retry loop with no delay is
    // the busy-wait it is about — it would spend the idle budget (B-4) on a
    // machine that is already not working.
    let mut state = RecoveryState::new();
    state.hint(RecoveryClock(0));

    assert_eq!(state.poll(RecoveryClock(250)), ReattachTrigger::Reattach);
    state.attempted(RecoveryClock(250), false);

    assert_eq!(state.poll(RecoveryClock(251)), ReattachTrigger::Wait);
    assert_eq!(state.poll(RecoveryClock(500)), ReattachTrigger::Reattach);
}

#[test]
fn repeated_failure_abandons_into_window_mode() {
    // DH-7: the fallback exists, and taking it is better than a machine that
    // retries forever. The realistic failure is a race with Explorer, which one
    // retry a debounce later distinguishes from a machine that cannot attach.
    let mut state = RecoveryState::new();
    state.hint(RecoveryClock(0));

    let mut now = 250;
    for _ in 0..MAX_ATTEMPTS {
        assert_eq!(state.poll(RecoveryClock(now)), ReattachTrigger::Reattach);
        state.attempted(RecoveryClock(now), false);
        now += 250;
    }

    assert_eq!(state.poll(RecoveryClock(now)), ReattachTrigger::Abandon);
}

#[test]
fn a_clock_that_steps_backwards_holds_rather_than_fires() {
    // A monotonic reading should not go backwards, but a saturating subtraction
    // is one line and the alternative failure is a re-attach storm.
    let mut state = RecoveryState::new();
    state.hint(RecoveryClock(10_000));

    assert_eq!(state.poll(RecoveryClock(9_000)), ReattachTrigger::Wait);
}

#[test]
fn polling_does_not_change_the_answer() {
    // Pure by construction: a caller that polls on every frame must not consume
    // the trigger by looking at it.
    let mut state = RecoveryState::new();
    state.hint(RecoveryClock(0));

    let first = state.poll(RecoveryClock(250));
    assert_eq!(first, state.poll(RecoveryClock(250)));
    assert_eq!(first, state.poll(RecoveryClock(250)));
}

#[test]
fn the_virtual_origin_is_the_top_left_of_the_whole_desk() {
    // WorkerW's client origin is the virtual screen's top-left, not the primary
    // monitor's (0, 0). Skipping the subtraction puts every window on a
    // left-of-primary desk wrong by the width of whatever is to the left.
    let plan = HostPlan::for_graph(&graph(vec![
        monitor("SN-PRIMARY", 0, 1920, 1080, 96),
        monitor("SN-LEFT", -2560, 2560, 1440, 96),
    ]));

    let origin = plan.virtual_origin();

    assert_eq!(origin.x, -2560);
    assert_eq!(origin.y, 0);
}

#[test]
fn a_single_primary_desk_has_a_zero_virtual_origin() {
    // The common case must not pay for the multi-monitor one: one monitor at
    // the origin means the conversion is the identity.
    let plan = HostPlan::for_graph(&graph(vec![monitor("SN-PRIMARY", 0, 1920, 1080, 96)]));

    assert_eq!(plan.virtual_origin().x, 0);
    assert_eq!(plan.virtual_origin().y, 0);
}

// ------------------------------------------------------------------ mode --

#[test]
fn the_default_is_attach_where_the_platform_can() {
    // DH-7 makes window mode the floor, not the default. A machine that can put
    // the desktop on the desktop should.
    assert_eq!(ModeRequest::from_env_value(None), ModeRequest::Auto);
    assert!(ModeRequest::Auto.should_attempt(true));
    assert!(!ModeRequest::Auto.should_attempt(false));
}

#[test]
fn an_operator_can_refuse_desktop_mode_on_a_machine_that_supports_it() {
    // The escape hatch has to exist: a desktop-attached window has no title bar
    // and no taskbar button, so a build that misbehaves needs a way to start in
    // something the user can close.
    for value in ["0", "off", "false", "no", "window", "windowed", "  OFF  "] {
        assert_eq!(
            ModeRequest::from_env_value(Some(value)),
            ModeRequest::ForceWindowed,
            "{value} must mean window mode"
        );
    }

    assert!(!ModeRequest::ForceWindowed.should_attempt(true));
}

#[test]
fn an_operator_can_force_an_attempt_on_a_machine_that_reports_no() {
    // For development: the difference between "not supported" and the system
    // call that said so is the whole diagnostic.
    for value in ["1", "on", "true", "yes", "desktop", "Desktop"] {
        assert_eq!(
            ModeRequest::from_env_value(Some(value)),
            ModeRequest::ForceDesktop,
            "{value} must mean desktop mode"
        );
    }

    assert!(ModeRequest::ForceDesktop.should_attempt(false));
}

#[test]
fn a_misspelled_value_starts_normally_rather_than_failing() {
    // Refusing to start because an environment variable was misspelled turns a
    // typo into a broken machine.
    assert_eq!(
        ModeRequest::from_env_value(Some("mabye")),
        ModeRequest::Auto
    );
    assert_eq!(ModeRequest::from_env_value(Some("")), ModeRequest::Auto);
}

#[test]
fn window_mode_always_says_why() {
    // XP-3 and DH-6: never a silent degradation. "My widgets are not on the
    // desktop" has to come with something the user can act on.
    let windowed = DesktopMode::Windowed {
        reason: "this session has no Explorer desktop to attach to".to_owned(),
    };

    assert!(!windowed.is_attached());
    assert!(!windowed.reason().unwrap_or_default().trim().is_empty());

    let attached = DesktopMode::Attached { monitors: 2 };
    assert!(attached.is_attached());
    assert_eq!(attached.reason(), None);
}
