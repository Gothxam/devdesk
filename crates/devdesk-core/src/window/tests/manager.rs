//! Topology adoption.

use devdesk_display::TopologyGeneration;

use crate::window::{ObserveError, WindowEvent, WindowManager};

use super::fixtures::{dark, docked, external_only, published, undocked};

#[test]
fn a_manager_that_has_not_looked_is_not_a_desktop_with_no_displays() {
    // Two different facts. Collapsing them would make a surface registered
    // before the first enumeration look like one on a machine with no screens.
    let manager = WindowManager::new();

    assert!(!manager.has_observed());
    assert!(!manager.has_displays());
    assert_eq!(manager.generation(), TopologyGeneration::INITIAL);
    assert!(manager.default_monitor().is_none());
}

#[test]
fn adopting_a_transaction_reports_the_arrangement_and_how_recent_it_is() {
    let shared = published(dark());
    let transaction = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    let events = manager.observe(&transaction).expect("a newer transaction");

    assert!(manager.has_observed());
    assert!(manager.has_displays());
    assert_eq!(manager.graph().monitors().len(), 2);

    match &events[..] {
        [WindowEvent::TopologyAdopted {
            generation,
            fingerprint,
            monitors,
        }] => {
            assert_eq!(*generation, transaction.generation());
            assert_eq!(fingerprint, &transaction.current().fingerprint());
            assert_eq!(*monitors, 2);
        }
        other => panic!("expected one TopologyAdopted, got {other:?}"),
    }
}

#[test]
fn a_stale_transaction_is_rejected_rather_than_ignored() {
    // Delivery order is not guaranteed once transactions cross a channel. A
    // stale one applied after a fresh one would reinstate a desktop that has
    // already been superseded, moving surfaces to displays that are gone.
    let shared = published(docked());
    let first = shared.publish(undocked()).expect("a change");
    let second = shared.publish(docked()).expect("another change");

    let mut manager = WindowManager::new();
    manager.observe(&second).expect("the newer one is adopted");

    let error = manager
        .observe(&first)
        .expect_err("replaying an older transaction is a caller bug");

    assert!(matches!(error, ObserveError::Stale { .. }));
    assert_eq!(
        manager.graph().monitors().len(),
        2,
        "the rejected transaction must not have been applied"
    );
    assert_eq!(manager.generation(), second.generation());
}

#[test]
fn re_adopting_the_same_generation_is_also_stale() {
    let shared = published(dark());
    let transaction = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");

    assert!(matches!(
        manager.observe(&transaction),
        Err(ObserveError::Stale { .. })
    ));
}

#[test]
fn the_default_monitor_is_the_primary_one() {
    // WD-5: an unknown topology resolves deterministically, and the primary
    // display is the deterministic choice.
    let shared = published(dark());
    let transaction = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");

    let default = manager
        .default_monitor()
        .expect("two displays are attached");
    assert_eq!(default.identity.serial(), Some("SN-LAPTOP"));
    assert!(default.is_primary);
}

#[test]
fn the_default_monitor_falls_back_to_identity_order_not_enumeration_order() {
    // Where the platform names no primary, the choice must still be
    // deterministic — and must not depend on the ordering WD-3 exists to stop
    // depending on.
    let shared = published(dark());
    let no_primary = devdesk_display::Topology::new(vec![
        super::fixtures::monitor(1, "SN-EXTERNAL", 1920, 2560, false),
        super::fixtures::monitor(0, "SN-LAPTOP", 0, 1920, false),
    ]);
    let transaction = shared.publish(no_primary).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");

    let chosen = manager
        .default_monitor()
        .expect("two displays are attached");
    let first_by_identity = manager.graph().monitors()[0].id();

    assert_eq!(chosen.id(), first_by_identity);
}

#[test]
fn a_desktop_with_no_displays_has_no_default_monitor() {
    let shared = published(docked());
    let transaction = shared.publish(dark()).expect("everything unplugged");

    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");

    assert!(manager.has_observed());
    assert!(!manager.has_displays());
    assert!(manager.default_monitor().is_none());
    assert!(manager.default_monitor_id().is_none());
}

#[test]
fn attachment_is_answered_by_identity() {
    let shared = published(dark());
    let docked_txn = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&docked_txn).expect("adopted");

    let external = docked_txn.current().monitors()[0].id().clone();
    let other = docked_txn.current().monitors()[1].id().clone();
    assert!(manager.is_attached(&external));
    assert!(manager.is_attached(&other));

    let undocked_txn = shared.publish(external_only()).expect("a change");
    manager.observe(&undocked_txn).expect("adopted");

    let still_here: Vec<_> = [external, other]
        .into_iter()
        .filter(|id| manager.is_attached(id))
        .collect();
    assert_eq!(still_here.len(), 1, "one of the two displays left");
}

#[test]
fn the_graph_handed_out_stays_consistent_after_a_later_adoption() {
    // WD-11 carried up a layer: a caller holding the manager's graph across
    // work keeps querying one desktop.
    let shared = published(dark());
    let first = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&first).expect("adopted");
    let held = std::sync::Arc::clone(manager.graph());

    let second = shared.publish(undocked()).expect("a change");
    manager.observe(&second).expect("adopted");

    assert_eq!(held.monitors().len(), 2, "the held snapshot did not change");
    assert_eq!(manager.graph().monitors().len(), 1);
}
