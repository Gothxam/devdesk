//! Races between topology changes, reveal steps, and the host.
//!
//! Every test here describes something that can only go wrong when two things
//! happen close together. They are grouped away from the lifecycle suite because
//! what they assert is different: not "the sequence works" but "the sequence
//! still works when it is interrupted, repeated, or run from two threads at
//! once".
//!
//! The properties under test, all asserted over the recorded command log:
//!
//! 1. No window is shown before it is created.
//! 2. No window is created twice, or shown twice.
//! 3. No surface is shown before it has painted.
//! 4. A stale topology never reaches the manager's state.
//!
//! EM-1 prohibits unwrap/expect in *non-test* code; a test asserting a
//! precondition is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Barrier};

use devdesk_core::window::{HostError, RevealState, WindowCommand};
use devdesk_display::SharedTopology;

use support::{dark, docked, external_only, host, monitor_id, replaced, surface, undocked};

// ------------------------------------------------- topology transactions --

#[test]
fn a_stale_transaction_never_reaches_the_state() {
    let (host, _sink) = host();
    let displays = SharedTopology::new();

    let older = displays.publish(docked()).expect("observed");
    let newer = displays.publish(undocked()).expect("a change");

    host.observe(&newer).expect("adopted");

    let rejected = host.observe(&older);
    assert!(matches!(rejected, Err(HostError::Observe(_))));

    host.with_manager(|manager| {
        assert_eq!(manager.generation(), newer.generation());
        assert_eq!(
            manager.graph().monitors().len(),
            1,
            "still the newer desktop"
        );
    });
}

#[test]
fn generations_apply_in_order_however_they_arrive() {
    // Transactions cross a channel; delivery order is not guaranteed. Whatever
    // order they arrive in, the manager ends up holding the newest.
    let (host, _sink) = host();
    let displays = SharedTopology::new();

    let first = displays.publish(docked()).expect("observed");
    let second = displays.publish(undocked()).expect("a change");
    let third = displays.publish(external_only()).expect("another change");

    // Deliberately out of order.
    host.observe(&third).expect("adopted");
    assert!(host.observe(&first).is_err());
    assert!(host.observe(&second).is_err());

    host.with_manager(|manager| {
        assert_eq!(manager.generation(), third.generation());
    });
}

#[test]
fn concurrent_observers_leave_the_newest_topology_adopted() {
    let (host, _sink) = host();
    let displays = SharedTopology::new();

    let transactions: Vec<_> = [docked(), undocked(), external_only(), docked()]
        .into_iter()
        .filter_map(|topology| displays.publish(topology))
        .collect();
    let newest = transactions.last().expect("at least one").generation();

    let host = Arc::new(host);
    let gate = Arc::new(Barrier::new(transactions.len()));

    let mut threads = Vec::new();
    for transaction in transactions {
        let host = Arc::clone(&host);
        let gate = Arc::clone(&gate);
        threads.push(std::thread::spawn(move || {
            gate.wait();
            // Stale ones are refused; that is the point, not a failure.
            let _ = host.observe(&transaction);
        }));
    }
    for thread in threads {
        thread.join().expect("no thread may fail");
    }

    host.with_manager(|manager| assert_eq!(manager.generation(), newest));
}

// ------------------------------------------------------------ reveal races --

#[test]
fn a_monitor_removed_mid_reveal_defers_the_show_until_one_returns() {
    // The surface painted into a hidden window on a machine whose lid has just
    // closed. Showing it would ask the windowing system to make something
    // visible on a desktop with no visible area.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");

    // Everything unplugged between the window existing and the frame arriving.
    host.observe(&displays.publish(dark()).expect("blackout"))
        .expect("adopted");

    host.report_first_frame(&clock).expect("painted");
    assert_eq!(
        sink.count(WindowCommand::makes_visible),
        0,
        "nowhere to show it"
    );
    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("registered");
        assert_eq!(record.reveal_state(), RevealState::Revealed, "it did paint");
        assert!(record.is_show_pending(), "and it is owed a show");
    });

    // A display returns, and the debt is discharged exactly once.
    host.observe(&displays.publish(docked()).expect("plugged back in"))
        .expect("adopted");
    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
    assert!(!sink.shown_before_created());
    host.with_manager(|manager| {
        assert!(!manager
            .surfaces()
            .get(&clock)
            .expect("registered")
            .is_show_pending());
    });

    // Further topology churn does not show it again.
    for topology in [undocked(), docked(), external_only()] {
        if let Some(transaction) = displays.publish(topology) {
            host.observe(&transaction).expect("adopted");
        }
    }
    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
}

#[test]
fn a_monitor_replaced_mid_reveal_still_reveals_once() {
    // The display the surface was on is unplugged and a different one appears in
    // the same step — identity changes, so this is a replacement rather than a
    // move.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");

    host.observe(&displays.publish(replaced()).expect("swapped"))
        .expect("adopted");

    host.report_first_frame(&clock).expect("painted");

    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("registered");
        assert!(record.is_visible());
        assert!(record.monitor().is_some(), "it landed on the new display");
        assert!(!record.is_show_pending());
    });
}

#[test]
fn a_topology_change_after_the_frame_does_not_show_anything_again() {
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");
    host.report_first_frame(&clock).expect("painted");
    assert_eq!(sink.count(WindowCommand::makes_visible), 1);

    for topology in [undocked(), dark(), docked(), external_only()] {
        if let Some(transaction) = displays.publish(topology) {
            host.observe(&transaction).expect("adopted");
        }
    }

    assert_eq!(
        sink.count(WindowCommand::makes_visible),
        1,
        "a shown surface is never shown again: {:?}",
        sink.log()
    );
}

#[test]
fn many_threads_reporting_one_frame_produce_exactly_one_show() {
    // A webview can report its first frame from more than one place, and a
    // reload races the original. Two shows for one window is a visible flicker.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");

    let host = Arc::new(host);
    let gate = Arc::new(Barrier::new(24));

    let mut threads = Vec::new();
    for _ in 0..24 {
        let host = Arc::clone(&host);
        let gate = Arc::clone(&gate);
        let clock = clock.clone();
        threads.push(std::thread::spawn(move || {
            gate.wait();
            host.report_first_frame(&clock).expect("painted");
        }));
    }
    for thread in threads {
        thread.join().expect("no thread may fail");
    }

    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
    assert_eq!(
        sink.count(|command| matches!(command, WindowCommand::CreateHidden { .. })),
        1
    );
}

#[test]
fn frames_and_topology_changes_racing_never_show_an_unpainted_surface() {
    // The property the whole subsystem exists for, under contention: one thread
    // churning the desktop while another drives surfaces through the reveal
    // sequence.
    let (host, sink) = host();
    let displays = Arc::new(SharedTopology::new());
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let host = Arc::new(host);
    let names: Vec<String> = (0..12).map(|index| format!("surface-{index}")).collect();

    let churn = {
        let host = Arc::clone(&host);
        let displays = Arc::clone(&displays);
        std::thread::spawn(move || {
            for round in 0..60 {
                let topology = match round % 4 {
                    0 => docked(),
                    1 => undocked(),
                    2 => external_only(),
                    _ => dark(),
                };
                if let Some(transaction) = displays.publish(topology) {
                    // A concurrent observer may have adopted a newer one first.
                    let _ = host.observe(&transaction);
                }
            }
        })
    };

    let mut threads = vec![churn];
    for name in names.clone() {
        let host = Arc::clone(&host);
        threads.push(std::thread::spawn(move || {
            let id = surface(&name);
            host.register(id.clone()).expect("registered");
            host.report_window_created(&id).expect("window exists");
            host.report_first_frame(&id).expect("painted");
        }));
    }
    for thread in threads {
        thread.join().expect("no thread may fail");
    }

    // Settle on a desktop that has a display, so every owed show is discharged.
    if let Some(transaction) = displays.publish(docked()) {
        let _ = host.observe(&transaction);
    }

    assert!(!sink.shown_before_created(), "{:?}", sink.log());
    assert!(!sink.has_duplicates(), "{:?}", sink.log());
    assert_eq!(
        sink.count(WindowCommand::makes_visible),
        names.len(),
        "every surface shown exactly once"
    );

    host.with_manager(|manager| {
        assert_eq!(manager.surfaces().visible().len(), names.len());
        assert!(
            manager.surfaces().awaiting_show().is_empty(),
            "no show left owed on a desktop with displays"
        );
    });
}

#[test]
fn registration_and_reveal_racing_never_reorder_the_commands() {
    // The reordering this subsystem's locking exists to prevent: computing under
    // a lock and dispatching outside it lets two threads compute in one order
    // and dispatch in the other, so a show can reach the windowing system before
    // the create that makes its window.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let host = Arc::new(host);
    let gate = Arc::new(Barrier::new(32));

    let mut threads = Vec::new();
    for index in 0..32 {
        let host = Arc::clone(&host);
        let gate = Arc::clone(&gate);
        threads.push(std::thread::spawn(move || {
            let id = surface(&format!("surface-{index}"));
            gate.wait();
            host.register(id.clone()).expect("registered");
            host.report_window_created(&id).expect("window exists");
            host.report_first_frame(&id).expect("painted");
        }));
    }
    for thread in threads {
        thread.join().expect("no thread may fail");
    }

    assert!(!sink.shown_before_created(), "{:?}", sink.log());
    assert!(!sink.has_duplicates());
    assert_eq!(sink.count(WindowCommand::makes_visible), 32);
}

#[test]
fn assignment_racing_a_topology_change_leaves_a_consistent_association() {
    let (host, sink) = host();
    let displays = Arc::new(SharedTopology::new());
    let first = displays.publish(docked()).expect("observed");
    host.observe(&first).expect("adopted");

    let laptop = monitor_id(&host, "SN-LAPTOP");
    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");
    host.report_first_frame(&clock).expect("painted");

    let host = Arc::new(host);
    let gate = Arc::new(Barrier::new(2));

    let churn = {
        let host = Arc::clone(&host);
        let displays = Arc::clone(&displays);
        let gate = Arc::clone(&gate);
        std::thread::spawn(move || {
            gate.wait();
            for round in 0..40 {
                let topology = if round % 2 == 0 { undocked() } else { docked() };
                if let Some(transaction) = displays.publish(topology) {
                    let _ = host.observe(&transaction);
                }
            }
        })
    };

    let assigning = {
        let host = Arc::clone(&host);
        let clock = clock.clone();
        let gate = Arc::clone(&gate);
        std::thread::spawn(move || {
            gate.wait();
            for _ in 0..40 {
                // Refused whenever the display is not currently attached, which
                // is the documented behaviour rather than a failure.
                let _ = host.assign(&clock, &laptop);
            }
        })
    };

    for thread in [churn, assigning] {
        thread.join().expect("no thread may fail");
    }

    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("still here");
        // Whatever the interleaving, the surface is on an attached display or on
        // none — never on one that has gone.
        if let Some(monitor) = record.monitor() {
            assert!(
                manager.is_attached(monitor),
                "associated with a display that left"
            );
        }
        assert!(record.is_visible());
    });

    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
    assert!(!sink.has_duplicates());
}
