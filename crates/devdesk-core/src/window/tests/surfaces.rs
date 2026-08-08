//! The surface registry and monitor association.

use crate::window::{AssociationReason, SurfaceError, WindowError, WindowEvent, WindowManager};

use super::fixtures::{dark, docked, external_only, published, surface, undocked};

/// A manager with the docked arrangement adopted.
fn docked_manager() -> (WindowManager, devdesk_display::SharedTopology) {
    let shared = published(dark());
    let transaction = shared.publish(docked()).expect("a change");
    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");
    (manager, shared)
}

fn monitor_named(manager: &WindowManager, serial: &str) -> devdesk_display::MonitorId {
    manager
        .graph()
        .monitors()
        .iter()
        .find(|m| m.identity.serial() == Some(serial))
        .map(|m| m.id().clone())
        .expect("the fixture display must be attached")
}

#[test]
fn registering_a_surface_allocates_a_window_and_a_display() {
    let (mut manager, _shared) = docked_manager();

    let events = manager
        .register_surface(surface("devdesk.clock"))
        .expect("a fresh identity");

    assert_eq!(events.len(), 2);
    assert!(matches!(events[0], WindowEvent::SurfaceRegistered { .. }));

    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("registered");
    assert!(!record.window().is_none());
    assert!(
        record.monitor().is_some(),
        "it lands on the default display"
    );
    assert!(
        record.preferred_monitor().is_none(),
        "an initial association is not a preference"
    );
}

#[test]
fn registering_the_same_surface_twice_is_an_error() {
    // Two callers believing they own one surface: the second would take over a
    // window the first is still driving.
    let (mut manager, _shared) = docked_manager();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("first");

    let error = manager
        .register_surface(surface("devdesk.clock"))
        .expect_err("second");

    assert!(matches!(
        error,
        WindowError::Surface(SurfaceError::AlreadyRegistered { .. })
    ));
    assert_eq!(manager.surfaces().len(), 1);
}

#[test]
fn a_surface_can_be_registered_before_any_display_is_known() {
    // Startup does not have to serialise enumeration against surface creation.
    let mut manager = WindowManager::new();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("registered");
    assert!(record.monitor().is_none());
}

#[test]
fn window_identities_are_distinct_per_surface_and_survive_removal() {
    let (mut manager, _shared) = docked_manager();
    manager.register_surface(surface("a")).expect("registered");
    manager.register_surface(surface("b")).expect("registered");

    let first = manager.surfaces().get(&surface("a")).expect("a").window();
    let second = manager.surfaces().get(&surface("b")).expect("b").window();
    assert_ne!(first, second);

    manager.remove_surface(&surface("a")).expect("removed");
    manager.register_surface(surface("c")).expect("registered");

    let third = manager.surfaces().get(&surface("c")).expect("c").window();
    assert_ne!(third, first, "a retired window identity is never reused");
    assert_ne!(third, second);
}

#[test]
fn removing_an_unknown_surface_is_an_error() {
    let (mut manager, _shared) = docked_manager();

    assert!(matches!(
        manager.remove_surface(&surface("nothing")),
        Err(WindowError::Surface(SurfaceError::Unknown { .. }))
    ));
}

#[test]
fn assigning_to_an_unattached_display_is_refused() {
    // A caller pointing at a display that is not there is working from a
    // topology it no longer holds. Substituting another display quietly would
    // place the surface somewhere nobody asked for.
    let (mut manager, shared) = docked_manager();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let external = monitor_named(&manager, "SN-EXTERNAL");
    let undock = shared.publish(undocked()).expect("a change");
    manager.observe(&undock).expect("adopted");

    assert!(matches!(
        manager.assign(&surface("devdesk.clock"), &external),
        Err(WindowError::MonitorNotAttached { .. })
    ));
}

#[test]
fn a_surface_falls_back_when_its_display_leaves() {
    let (mut manager, shared) = docked_manager();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let external = monitor_named(&manager, "SN-EXTERNAL");
    manager
        .assign(&surface("devdesk.clock"), &external)
        .expect("assigned to the external display");

    let undock = shared
        .publish(undocked())
        .expect("the external display left");
    let events = manager.observe(&undock).expect("adopted");

    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("still here");
    assert_ne!(record.monitor(), Some(&external), "it moved");
    assert_eq!(
        record.preferred_monitor(),
        Some(&external),
        "but it still belongs on the external display"
    );
    assert!(record.is_displaced());

    assert!(events.iter().any(|event| matches!(
        event,
        WindowEvent::SurfaceAssociated {
            reason: AssociationReason::MonitorRemoved,
            ..
        }
    )));
}

#[test]
fn a_surface_goes_home_when_its_display_returns() {
    // The dock/undock round trip. Without this the arrangement erodes one cycle
    // at a time, and no single step looks like a bug.
    let (mut manager, shared) = docked_manager();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let external = monitor_named(&manager, "SN-EXTERNAL");
    manager
        .assign(&surface("devdesk.clock"), &external)
        .expect("assigned");

    let undock = shared.publish(undocked()).expect("undocked");
    manager.observe(&undock).expect("adopted");

    let redock = shared.publish(docked()).expect("redocked");
    let events = manager.observe(&redock).expect("adopted");

    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("still here");
    assert_eq!(record.monitor(), Some(&external), "it went home");
    assert!(!record.is_displaced());

    assert!(events.iter().any(|event| matches!(
        event,
        WindowEvent::SurfaceAssociated {
            reason: AssociationReason::MonitorReturned,
            ..
        }
    )));
}

#[test]
fn a_topology_change_that_does_not_affect_a_surface_emits_nothing_for_it() {
    // Otherwise every consumer re-does work for every unrelated display event.
    let (mut manager, shared) = docked_manager();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let laptop = monitor_named(&manager, "SN-LAPTOP");
    manager
        .assign(&surface("devdesk.clock"), &laptop)
        .expect("assigned");

    // The external display changes resolution; the laptop panel does not move.
    let resized = devdesk_display::Topology::new(vec![
        super::fixtures::monitor(0, "SN-LAPTOP", 0, 1920, true),
        super::fixtures::monitor(1, "SN-EXTERNAL", 1920, 3840, false),
    ]);
    let transaction = shared.publish(resized).expect("a change");
    let events = manager.observe(&transaction).expect("adopted");

    assert_eq!(events.len(), 1, "only the topology event: {events:?}");
    assert!(matches!(events[0], WindowEvent::TopologyAdopted { .. }));
}

#[test]
fn every_display_leaving_detaches_rather_than_destroys() {
    // A closed lid with nothing plugged in is a real state. Destroying the
    // surface would lose the arrangement rather than suspend it.
    let (mut manager, shared) = docked_manager();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let laptop = monitor_named(&manager, "SN-LAPTOP");
    manager
        .assign(&surface("devdesk.clock"), &laptop)
        .expect("assigned");

    let blackout = shared.publish(dark()).expect("everything unplugged");
    let events = manager.observe(&blackout).expect("adopted");

    assert_eq!(manager.surfaces().len(), 1, "the surface still exists");
    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("still here");
    assert!(record.monitor().is_none());
    assert_eq!(record.preferred_monitor(), Some(&laptop));

    assert!(events.iter().any(|event| matches!(
        event,
        WindowEvent::SurfaceAssociated {
            reason: AssociationReason::NoDisplaysAttached,
            to: None,
            ..
        }
    )));

    // And it comes back when a display does.
    let relit = shared.publish(docked()).expect("plugged back in");
    manager.observe(&relit).expect("adopted");
    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("still here");
    assert_eq!(record.monitor(), Some(&laptop));
}

#[test]
fn a_detached_surface_lands_on_the_default_when_a_display_appears() {
    // Registered before enumeration, with no preference to honour.
    let mut manager = WindowManager::new();
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    let shared = published(dark());
    let transaction = shared.publish(external_only()).expect("a display appeared");
    manager.observe(&transaction).expect("adopted");

    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("still here");
    assert!(record.monitor().is_some());
    assert!(
        record.preferred_monitor().is_none(),
        "a fallback must not become a preference"
    );
}

#[test]
fn surfaces_iterate_in_identity_order_not_registration_order() {
    // Registration order is an accident of startup timing. A consumer deriving
    // anything from it would produce a different result on a run where two
    // surfaces registered the other way round.
    let (mut manager, _shared) = docked_manager();
    for name in ["zulu", "alpha", "mike"] {
        manager.register_surface(surface(name)).expect("registered");
    }

    let order: Vec<&str> = manager
        .surfaces()
        .iter()
        .map(|record| record.surface().as_str())
        .collect();

    assert_eq!(order, vec!["alpha", "mike", "zulu"]);
}

#[test]
fn surfaces_can_be_listed_by_display_and_by_detachment() {
    let (mut manager, shared) = docked_manager();
    manager.register_surface(surface("a")).expect("registered");
    manager.register_surface(surface("b")).expect("registered");

    let laptop = monitor_named(&manager, "SN-LAPTOP");
    let external = monitor_named(&manager, "SN-EXTERNAL");
    manager.assign(&surface("a"), &laptop).expect("assigned");
    manager.assign(&surface("b"), &external).expect("assigned");

    assert_eq!(manager.surfaces().on_monitor(&laptop).len(), 1);
    assert_eq!(manager.surfaces().on_monitor(&external).len(), 1);
    assert!(manager.surfaces().detached().is_empty());

    let blackout = shared.publish(dark()).expect("everything unplugged");
    manager.observe(&blackout).expect("adopted");

    assert_eq!(manager.surfaces().detached().len(), 2);
}
