//! Surface lifecycle when something goes wrong or happens out of order.
//!
//! The lifecycle suite covers the path where everything works. This covers the
//! ends of it: a window that could not be created, a surface destroyed before it
//! ever appeared, an identity used again after its surface was removed, and a
//! windowing system that refuses.
//!
//! The property underneath all of them is that the registry and the windowing
//! system do not disagree. A surface with no window is unusable and invisible; a
//! window with no surface is unreachable and permanent. Both are leaks, and each
//! failure path below is a place one could be created.
//!
//! EM-1 prohibits unwrap/expect in *non-test* code; a test asserting a
//! precondition is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use devdesk_core::window::{HostError, RevealState, WindowCommand};
use devdesk_display::SharedTopology;

use support::{dark, docked, host, surface, undocked};

/// A host with the docked arrangement adopted.
fn ready() -> (
    devdesk_core::window::SurfaceHost,
    std::sync::Arc<support::RecordingSink>,
    SharedTopology,
) {
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");
    (host, sink, displays)
}

// ------------------------------------------------------- creation failure --

#[test]
fn a_surface_whose_window_cannot_be_created_is_not_left_registered() {
    // The orphan this rollback exists to prevent: a surface holding an identity
    // against a window that was never made. It would be invisible, unusable,
    // and — because the identity is taken — impossible to replace.
    let (host, sink, _displays) = ready();
    sink.set_fail_create(true);

    let clock = surface("devdesk.clock");
    let failed = host.register(clock.clone());

    assert!(matches!(failed, Err(HostError::Sink { .. })));
    host.with_manager(|manager| {
        assert!(!manager.surfaces().contains(&clock));
        assert_eq!(manager.surfaces().len(), 0);
    });
}

#[test]
fn a_rolled_back_registration_can_be_retried() {
    let (host, sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    sink.set_fail_create(true);
    assert!(host.register(clock.clone()).is_err());

    sink.set_fail_create(false);
    host.register(clock.clone())
        .expect("the identity is free again");

    host.with_manager(|manager| assert!(manager.surfaces().contains(&clock)));
    assert_eq!(
        sink.count(|command| matches!(command, WindowCommand::CreateHidden { .. })),
        1,
        "only the successful create was recorded"
    );
}

#[test]
fn a_retried_registration_gets_a_fresh_window_identity() {
    // The failed attempt consumed an identity, and it is not handed out again.
    // A command queued against the first attempt must not reach the second.
    let (host, sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    sink.set_fail_create(true);
    assert!(host.register(clock.clone()).is_err());
    sink.set_fail_create(false);

    let outcome = host.register(clock.clone()).expect("registered");
    let window = outcome.commands()[0].window();

    assert!(
        window.get() > 1,
        "the failed attempt's identity was retired"
    );
}

// ------------------------------------------------- destroyed before reveal --

#[test]
fn a_surface_removed_before_it_paints_is_destroyed_and_never_shown() {
    let (host, sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");

    let created_window =
        host.with_manager(|manager| manager.surfaces().get(&clock).expect("registered").window());

    host.remove(&clock).expect("removed");

    assert_eq!(sink.destroyed(), vec![created_window]);
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
    host.with_manager(|manager| assert!(!manager.surfaces().contains(&clock)));
}

#[test]
fn a_frame_for_a_removed_surface_is_refused_and_shows_nothing() {
    // The webview may be mid-paint when its surface is removed. Its report
    // arrives for something that no longer exists.
    let (host, sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");
    host.remove(&clock).expect("removed");

    let late = host.report_first_frame(&clock);
    assert!(matches!(late, Err(HostError::Window(_))));
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
}

#[test]
fn removing_a_surface_that_is_owed_a_show_cancels_the_debt() {
    // It painted while the desktop was dark, then was removed before a display
    // returned. The debt must go with it, or the next topology change shows a
    // window belonging to a surface nobody has.
    let (host, sink, displays) = ready();
    let clock = surface("devdesk.clock");

    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");
    host.observe(&displays.publish(dark()).expect("blackout"))
        .expect("adopted");
    host.report_first_frame(&clock).expect("painted");

    host.with_manager(|manager| {
        assert_eq!(manager.surfaces().awaiting_show().len(), 1);
    });

    host.remove(&clock).expect("removed");

    host.observe(&displays.publish(docked()).expect("plugged back in"))
        .expect("adopted");

    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
    host.with_manager(|manager| assert!(manager.surfaces().awaiting_show().is_empty()));
}

// ------------------------------------------------- recreate after destroy --

#[test]
fn an_identity_reused_after_removal_starts_over_completely() {
    let (host, sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");
    host.report_first_frame(&clock).expect("painted");

    let first_window =
        host.with_manager(|manager| manager.surfaces().get(&clock).expect("registered").window());
    host.remove(&clock).expect("removed");

    host.register(clock.clone())
        .expect("the identity is free again");

    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("registered again");
        assert_ne!(record.window(), first_window, "a new window identity");
        assert_eq!(
            record.reveal_state(),
            RevealState::Created,
            "and it must paint again before it is visible"
        );
        assert!(!record.is_visible());
        assert!(!record.is_show_pending());
        assert!(
            record.preferred_monitor().is_none(),
            "the previous arrangement did not survive removal"
        );
    });

    // And it is not on screen until it paints again.
    assert_eq!(
        sink.count(WindowCommand::makes_visible),
        1,
        "only the first life"
    );
}

#[test]
fn a_recreated_surface_reveals_on_its_own_frame() {
    let (host, sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    for _ in 0..3 {
        host.register(clock.clone()).expect("registered");
        host.report_window_created(&clock).expect("window exists");
        host.report_first_frame(&clock).expect("painted");
        host.remove(&clock).expect("removed");
    }

    assert_eq!(
        sink.count(|command| matches!(command, WindowCommand::CreateHidden { .. })),
        3
    );
    assert_eq!(sink.count(WindowCommand::makes_visible), 3);
    assert_eq!(sink.destroyed().len(), 3);
    assert!(!sink.shown_before_created());
    assert!(!sink.has_duplicates(), "each life had its own window");
}

// ---------------------------------------------------------- removal failure --

#[test]
fn removal_is_final_and_a_second_one_is_an_error_rather_than_a_no_op() {
    // Keeping a surface registered because the windowing system hiccuped would
    // leave one the user believes they deleted, and it would come back on the
    // next arrangement restore. So removal commits at the state level, and
    // asking twice is a caller bug rather than something to absorb.
    let (host, _sink, _displays) = ready();
    let clock = surface("devdesk.clock");

    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");

    host.remove(&clock).expect("removed");
    host.with_manager(|manager| assert!(!manager.surfaces().contains(&clock)));

    assert!(matches!(host.remove(&clock), Err(HostError::Window(_))));
}

#[test]
fn hidden_surfaces_are_cleaned_up_without_ever_appearing() {
    // Twelve surfaces created and removed without any of them painting: the
    // whole run must never make anything visible.
    let (host, sink, displays) = ready();

    for index in 0..12 {
        let id = surface(&format!("surface-{index}"));
        host.register(id.clone()).expect("registered");
        host.report_window_created(&id).expect("window exists");

        // Churn the desktop underneath the cleanup. Republishing an unchanged
        // arrangement yields nothing, which is the documented behaviour and not
        // a reason for the loop to stop.
        let arrangement = if index % 2 == 0 { undocked() } else { docked() };
        if let Some(transaction) = displays.publish(arrangement) {
            host.observe(&transaction).expect("adopted");
        }

        host.remove(&id).expect("removed");
    }

    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
    assert_eq!(sink.destroyed().len(), 12);
    host.with_manager(|manager| {
        assert!(manager.surfaces().is_empty());
        assert!(manager.surfaces().awaiting_show().is_empty());
    });
}
