//! What the window subsystem costs.
//!
//! Four things, chosen because each one sits on a path a user waits for:
//!
//! | Measured | Why it matters |
//! | --- | --- |
//! | Reveal | `PB-R6` — surface show, hidden → first frame, ≤ 100 ms p95 |
//! | Topology publish | `PB-G7` — the display share of a topology change |
//! | Association | Runs once per surface per topology change, so it multiplies |
//! | 32-surface concurrency | Startup, where every surface reveals at once |
//!
//! The sink is a recording one, so what is measured is **the subsystem, not the
//! windowing system**. That is deliberate: `PB-R6` is dominated by webview
//! startup, which this crate does not control and cannot speed up, and mixing
//! the two would hide a regression in the part that is ours behind noise in the
//! part that is not.
//!
//! Everything here is informational (`ADR-0002` `D-2`, `MM-1`) — a developer
//! machine, not the §6.1 reference machine. The method is still the ADR's, so
//! these numbers stay comparable with the reference-machine ones that replace
//! them.
//!
//! EM-1 prohibits unwrap/expect in *non-test* code; a test asserting a
//! precondition is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[path = "harness.rs"]
mod harness;

#[path = "../integration/support.rs"]
mod support;

use std::sync::{Arc, Barrier};
use std::time::Duration;

use devdesk_core::window::{SurfaceHost, SurfaceId};
use devdesk_display::SharedTopology;

use harness::{measure, measure_prepared, preamble, Measurement};
use support::{docked, host, surface, undocked};

/// Surfaces in the steady-state fixture.
const SURFACES: usize = 8;
/// Threads in the concurrency case — the startup shape.
const CONCURRENT: usize = 32;

/// A host with a docked desktop and `count` surfaces already revealed.
fn populated(count: usize) -> (SurfaceHost, SharedTopology, Vec<SurfaceId>) {
    let (host, _sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let mut ids = Vec::with_capacity(count);
    for index in 0..count {
        let id = surface(&format!("surface-{index}"));
        host.register(id.clone()).expect("registered");
        host.report_window_created(&id).expect("window exists");
        host.report_first_frame(&id).expect("painted");
        ids.push(id);
    }

    (host, displays, ids)
}

#[test]
fn the_window_subsystem_costs_what_it_can_account_for() {
    preamble(&format!(
        "Window subsystem — {SURFACES} surfaces, 2 displays, mixed DPI"
    ));

    // --- reveal ---------------------------------------------------------
    // Prepared fresh each time: a surface reveals once, so measuring it in a
    // batch would measure the no-op that a second frame signal correctly is.
    let reveal = measure_prepared(
        "reveal: first frame → show dispatched",
        || {
            let (host, _sink) = host();
            let displays = SharedTopology::new();
            host.observe(&displays.publish(docked()).expect("observed"))
                .expect("adopted");
            let id = surface("devdesk.clock");
            host.register(id.clone()).expect("registered");
            host.report_window_created(&id).expect("window exists");
            (host, id)
        },
        |(host, id)| {
            std::hint::black_box(host.report_first_frame(id).expect("painted"));
        },
    );

    // --- topology publish -----------------------------------------------
    let (steady, displays, ids) = populated(SURFACES);
    let mut docking = false;
    let publish = measure("topology publish → adopted and re-associated", 50, || {
        docking = !docking;
        let next = if docking { undocked() } else { docked() };
        if let Some(transaction) = displays.publish(next) {
            std::hint::black_box(steady.observe(&transaction).expect("adopted"));
        }
    });

    // --- association -----------------------------------------------------
    let monitors: Vec<_> = steady.with_manager(|manager| {
        manager
            .graph()
            .monitors()
            .iter()
            .map(|monitor| monitor.id().clone())
            .collect()
    });
    // Settle on the docked arrangement so both displays are attached.
    if let Some(transaction) = displays.publish(docked()) {
        let _ = steady.observe(&transaction);
    }
    let mut which = 0usize;
    let associate = measure("association: assign one surface to a display", 200, || {
        which = which.wrapping_add(1);
        let monitor = &monitors[which % monitors.len().max(1)];
        // Refused when that display is not currently attached, which is the
        // documented behaviour; the cost is the same either way.
        std::hint::black_box(steady.assign(&ids[which % ids.len()], monitor).ok());
    });

    // --- concurrency -----------------------------------------------------
    // The startup shape: every surface racing to reveal at once. Measured as
    // whole wall-clock for the fan-out, then divided, so contention is included
    // rather than measured away.
    let concurrency = measure_prepared(
        "startup: 32 surfaces registered and revealed concurrently",
        || {
            let (host, _sink) = host();
            let displays = SharedTopology::new();
            host.observe(&displays.publish(docked()).expect("observed"))
                .expect("adopted");
            Arc::new(host)
        },
        |host| {
            let gate = Arc::new(Barrier::new(CONCURRENT));
            let mut threads = Vec::with_capacity(CONCURRENT);

            for index in 0..CONCURRENT {
                let host = Arc::clone(host);
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
        },
    );

    let measurements = [reveal, publish, associate, concurrency];
    for measurement in &measurements {
        measurement.report();
    }
    println!();

    assert_budgets(&measurements);
}

/// Regression guards, not budgets.
///
/// Each sits far above the measured value. They catch an algorithmic
/// regression — an association pass that becomes quadratic in surfaces, a
/// reveal that starts cloning the topology, a lock that starts serialising
/// something it should not — and stay quiet on a loaded runner and in either
/// profile. Gating on wall-clock is the reference runner's job.
fn assert_budgets(measurements: &[Measurement]) {
    for measurement in measurements {
        assert!(
            measurement.median.is_finite(),
            "{} produced no measurement",
            measurement.label
        );
    }

    let reveal = &measurements[0];
    assert!(
        Duration::from_nanos(reveal.p95 as u64) < Duration::from_millis(5),
        "reveal took {:.3} ms, which is a third of PB-R6 spent before the webview is even asked",
        reveal.p95 / 1_000_000.0
    );

    let concurrency = &measurements[3];
    assert!(
        Duration::from_nanos(concurrency.p95 as u64) < Duration::from_millis(250),
        "32-surface startup took {:.1} ms, which would be visible in PB-S1",
        concurrency.p95 / 1_000_000.0
    );
}
