//! Transactional topology changes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::hotplug::{HotplugDebouncer, DEFAULT_DEBOUNCE};
use crate::topology::Topology;
use crate::transaction::{SharedTopology, TopologyGeneration};

use super::fixtures::identified;

fn docked() -> Topology {
    Topology::new(vec![
        identified(0, "SN-LAPTOP")
            .bounds(0, 0, 1920, 1080)
            .primary(true)
            .build(),
        identified(1, "SN-EXTERNAL")
            .bounds(1920, 0, 2560, 1440)
            .primary(false)
            .build(),
    ])
}

fn undocked() -> Topology {
    Topology::new(vec![identified(0, "SN-LAPTOP")
        .bounds(0, 0, 1920, 1080)
        .primary(true)
        .build()])
}

#[test]
fn the_first_publication_has_no_previous_arrangement() {
    // A consumer restoring a saved arrangement at startup does something
    // different from one reacting to every display being unplugged. Modelling
    // the first publication as "previous was empty" would make them look alike.
    let shared = SharedTopology::new();
    assert!(!shared.has_observed());
    assert_eq!(shared.generation(), TopologyGeneration::INITIAL);

    let first = shared.publish(docked()).expect("a first publication");

    assert!(first.is_initial());
    assert!(first.previous().is_none());
    assert!(first.previous_graph().is_none());
    assert_eq!(first.generation().get(), 1);
    assert_eq!(first.diff().added().len(), 2);
}

#[test]
fn a_transaction_carries_both_arrangements_and_the_difference() {
    let shared = SharedTopology::new();
    shared.publish(docked());

    let change = shared.publish(undocked()).expect("undocking is a change");

    assert_eq!(change.previous().expect("docked").monitors().len(), 2);
    assert_eq!(change.current().monitors().len(), 1);
    assert_eq!(change.diff().removed().len(), 1);
    assert!(change.diff().membership_changed());
    assert_eq!(change.graph().monitors().len(), 1);
    assert_eq!(
        change
            .previous_graph()
            .expect("the docked graph")
            .monitors()
            .len(),
        2
    );
}

#[test]
fn republishing_the_same_arrangement_is_not_a_change() {
    // WD-6 treats platform events as hints and re-queries. Windows emits
    // WM_DISPLAYCHANGE for changes that leave the topology alone, and a hint
    // that turned out to be nothing must not look like a change.
    let shared = SharedTopology::new();
    shared.publish(docked());
    let generation = shared.generation();

    assert!(shared.publish(docked()).is_none());
    assert_eq!(
        shared.generation(),
        generation,
        "an unchanged republication must not advance the generation"
    );
}

#[test]
fn publishing_no_displays_at_all_is_still_a_publication() {
    // It is how a consumer learns there are no displays, which it cannot infer
    // from silence.
    let shared = SharedTopology::new();
    let first = shared
        .publish(Topology::new(vec![]))
        .expect("an empty desktop is still an observation");

    assert!(first.is_initial());
    assert!(first.current().is_empty());
    assert!(shared.has_observed());
}

#[test]
fn the_generation_advances_even_when_returning_to_a_known_arrangement() {
    // A fingerprint cannot do this job: undock and redock returns to a
    // fingerprint already seen, and a consumer holding stale work could not tell
    // that it was stale.
    let shared = SharedTopology::new();
    shared.publish(docked());
    shared.publish(undocked());
    let redocked = shared.publish(docked()).expect("redocking is a change");

    assert_eq!(redocked.generation().get(), 3);
    assert_eq!(
        redocked.current().fingerprint(),
        docked().fingerprint(),
        "the arrangement is one already seen, which is why the fingerprint cannot report recency"
    );
}

#[test]
fn a_display_moving_is_not_a_display_arriving() {
    let shared = SharedTopology::new();
    shared.publish(docked());

    let rearranged = Topology::new(vec![
        identified(0, "SN-LAPTOP")
            .bounds(0, 0, 1920, 1080)
            .primary(true)
            .build(),
        identified(1, "SN-EXTERNAL")
            .bounds(-2560, 0, 2560, 1440)
            .primary(false)
            .build(),
    ]);

    let change = shared.publish(rearranged).expect("a move is a change");

    assert!(!change.diff().membership_changed());
    assert_eq!(change.diff().moved().len(), 1);
    assert!(change.diff().added().is_empty());
    assert!(change.diff().removed().is_empty());
}

#[test]
fn a_scale_change_is_reported_without_a_move() {
    let shared = SharedTopology::new();
    shared.publish(undocked());

    let scaled = Topology::new(vec![identified(0, "SN-LAPTOP")
        .bounds(0, 0, 1920, 1080)
        .dpi(144)
        .primary(true)
        .build()]);

    let change = shared.publish(scaled).expect("a scale change is a change");

    assert_eq!(change.diff().rescaled().len(), 1);
    assert!(change.diff().moved().is_empty());
    assert!(!change.diff().membership_changed());
}

#[test]
fn a_taskbar_moving_changes_the_work_area_and_nothing_else() {
    let shared = SharedTopology::new();
    shared.publish(undocked());

    let mut raw = identified(0, "SN-LAPTOP")
        .bounds(0, 0, 1920, 1080)
        .raw()
        .clone();
    raw.work_area.x = 80;
    raw.work_area.width = 1840;

    let relocated_taskbar = Topology::new(vec![
        crate::monitor::MonitorDescriptor::from_raw(&raw).expect("still usable")
    ]);

    let change = shared
        .publish(relocated_taskbar)
        .expect("the usable area changed");

    assert_eq!(change.diff().work_area_changed().len(), 1);
    assert!(change.diff().moved().is_empty());
    assert!(change.diff().resized().is_empty());
}

#[test]
fn the_primary_display_changing_is_reported() {
    let shared = SharedTopology::new();
    shared.publish(docked());

    let swapped = Topology::new(vec![
        identified(0, "SN-LAPTOP")
            .bounds(0, 0, 1920, 1080)
            .primary(false)
            .build(),
        identified(1, "SN-EXTERNAL")
            .bounds(1920, 0, 2560, 1440)
            .primary(true)
            .build(),
    ]);

    let change = shared.publish(swapped).expect("primary moved");
    assert!(change.diff().primary_changed());
}

#[test]
fn a_display_whose_serial_became_unreadable_is_not_a_removal_and_an_addition() {
    // Pairing falls back to conclusive identity, so a display that stops
    // reporting a serial between enumerations does not tear down its surfaces
    // and rebuild them for a display that never left.
    let shared = SharedTopology::new();
    shared.publish(undocked());

    let mut raw = identified(0, "SN-LAPTOP")
        .bounds(0, 0, 1920, 1080)
        .raw()
        .clone();
    raw.serial = None;

    let without_serial = Topology::new(vec![
        crate::monitor::MonitorDescriptor::from_raw(&raw).expect("usable")
    ]);

    let change = shared
        .publish(without_serial)
        .expect("the identity key changed");

    assert!(
        !change.diff().membership_changed(),
        "the device path still matches conclusively"
    );
}

#[test]
fn a_consumer_never_observes_a_half_updated_arrangement() {
    // The guarantee the type exists for. A reader spinning while a writer
    // publishes must never see a graph that disagrees with its own topology, or
    // a generation that does not match the displays alongside it.
    let shared = Arc::new(SharedTopology::new());
    shared.publish(docked());

    let stop = Arc::new(AtomicBool::new(false));

    let reader = {
        let shared = Arc::clone(&shared);
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            let mut observations = 0usize;
            while !stop.load(Ordering::Relaxed) {
                let graph = shared.graph();
                let count = graph.monitors().len();

                assert!(
                    count == 1 || count == 2,
                    "observed an arrangement that never existed: {count} displays"
                );
                assert_eq!(
                    graph.fingerprint(),
                    &graph.topology().fingerprint(),
                    "the graph disagreed with the topology it indexes"
                );
                assert_eq!(
                    graph.monitors().len(),
                    graph.topology().monitors().len(),
                    "the graph and its snapshot were not the same value"
                );

                observations += 1;
            }
            observations
        })
    };

    for _ in 0..200 {
        shared.publish(undocked());
        shared.publish(docked());
    }

    stop.store(true, Ordering::Relaxed);
    let observations = reader.join().expect("the reader must not have failed");

    assert!(observations > 0, "the reader must have observed something");
}

#[test]
fn a_burst_of_hints_produces_one_requery() {
    // Undocking emits a burst over a few hundred milliseconds. Re-enumerating on
    // each one produces arrangements that existed only momentarily.
    let start = Instant::now();
    let mut debouncer = HotplugDebouncer::new(DEFAULT_DEBOUNCE);

    for offset in [0u64, 40, 90, 150] {
        debouncer.hint(start + Duration::from_millis(offset));
        assert!(
            !debouncer.take_if_settled(start + Duration::from_millis(offset + 10)),
            "the burst has not settled"
        );
    }

    assert!(debouncer.take_if_settled(start + Duration::from_millis(410)));
    assert!(
        !debouncer.take_if_settled(start + Duration::from_millis(900)),
        "one burst produces one re-query, however often it is polled"
    );
}

#[test]
fn each_hint_restarts_the_window_rather_than_extending_a_deadline() {
    // A docking event settling over 400 ms would otherwise fire a re-query in
    // the middle of it, against an arrangement still changing.
    let start = Instant::now();
    let mut debouncer = HotplugDebouncer::new(Duration::from_millis(250));

    debouncer.hint(start);
    debouncer.hint(start + Duration::from_millis(200));

    assert!(!debouncer.take_if_settled(start + Duration::from_millis(260)));
    assert!(debouncer.take_if_settled(start + Duration::from_millis(451)));
}

#[test]
fn nothing_is_due_when_nothing_was_hinted() {
    let mut debouncer = HotplugDebouncer::default();
    let now = Instant::now();

    assert!(!debouncer.is_pending());
    assert!(!debouncer.take_if_settled(now));
    assert!(debouncer.time_remaining(now).is_none());

    debouncer.hint(now);
    assert!(debouncer.is_pending());
    assert_eq!(
        debouncer.time_remaining(now),
        Some(Duration::from_millis(250))
    );

    // Shutdown abandons the hint, so a re-query cannot fire against a backend
    // whose subscription has already been torn down.
    debouncer.cancel();
    assert!(!debouncer.is_pending());
}
