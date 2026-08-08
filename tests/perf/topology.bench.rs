//! `PB-G7` — the display subsystem's share of a topology change.
//!
//! `PB-G7` budgets the whole path: topology change → layout reapplied → all
//! surfaces repainted, ≤ 400 ms p95 after the 250 ms WD-6 debounce. Layout and
//! repaint do not exist yet. What this measures is the part that does — the
//! re-query, the diff, the graph rebuild, and the queries a layout pass will run
//! against it — so that when the rest arrives, the share already spent is known
//! rather than inferred.
//!
//! **Every number this prints is informational** (`ADR-0002` `D-2`, `MM-1`). A
//! measurement is normative only on the §6.1 reference machine under its
//! environmental controls, and that machine is commissioned later in the sprint.
//! The statistical method is still the ADR's — `MM-11`'s 20 iterations after 3
//! discarded warm-ups, `MM-12`'s median of three independent runs — because a
//! developer-machine number taken a different way could not be compared with the
//! reference-machine number that replaces it.
//!
//! The assertions are deliberately far above the measured values. They exist to
//! catch an algorithmic regression — a query that starts cloning the topology, a
//! rebuild that becomes quadratic in surfaces — not to gate on wall-clock, which
//! would be flaky on a loaded runner and is not this harness's job to decide.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;
use std::time::{Duration, Instant};

use devdesk_display::diff::TopologyDiff;
use devdesk_display::graph::{Direction, DisplayGraph};
use devdesk_display::monitor::MonitorDescriptor;
use devdesk_display::topology::Topology;
use devdesk_display::transaction::SharedTopology;
use devdesk_display::PhysicalPoint;
use devdesk_platform::{Connector, ConnectorKind, PlatformFeature, RawMonitorInfo, RawRect};

/// MM-11: iterations per run, after the discarded warm-ups.
const ITERATIONS: usize = 20;
/// MM-11: warm-up iterations, discarded.
const WARM_UPS: usize = 3;
/// MM-12: independent runs, of whose medians the median is reported.
const RUNS: usize = 3;

/// The ADR-0002 §6.1 reference display set: 2560×1440 @ 100%, 1920×1080 @ 100%,
/// 3840×2160 @ 150%. Mixed DPI is mandatory (`TS-5`, WD-2) — a uniform-DPI
/// fixture cannot detect the largest defect class in this system (`AP-6`).
fn reference_displays() -> Vec<MonitorDescriptor> {
    [
        raw(0, "SN-PRIMARY", 0, 0, 2560, 1440, 96, true),
        raw(1, "SN-SIDE", 2560, 0, 1920, 1080, 96, false),
        raw(2, "SN-HIDPI", 4480, 0, 3840, 2160, 144, false),
    ]
    .iter()
    .map(|record| MonitorDescriptor::from_raw(record).expect("the fixture must be usable"))
    .collect()
}

#[allow(clippy::too_many_arguments)]
fn raw(
    index: u32,
    serial: &str,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    dpi: u32,
    is_primary: bool,
) -> RawMonitorInfo {
    RawMonitorInfo {
        device_path: Some(format!(r"\\?\DISPLAY#ACM1234#5&bench{index}&0&UID{index}")),
        adapter: Some(format!("00000000bench:{index}")),
        serial: Some(serial.to_owned()),
        connector: Some(Connector {
            kind: ConnectorKind::DisplayPort,
            instance: index,
        }),
        manufacturer: Some("ACM".to_owned()),
        product_code: Some(0x1234),
        friendly_name: Some(format!("Bench {serial}")),
        os_device_name: Some(format!(r"\\.\DISPLAY{}", index + 1)),
        bounds: RawRect {
            x,
            y,
            width,
            height,
        },
        work_area: RawRect {
            x,
            y,
            width,
            height: height.saturating_sub(48),
        },
        dpi,
        refresh_millihertz: Some(59_940),
        is_primary,
        os_enumeration_index: index,
    }
}

/// One measured operation's timings, in nanoseconds per operation.
struct Measurement {
    label: &'static str,
    median: f64,
    p95: f64,
    min: f64,
}

impl Measurement {
    fn report(&self) {
        println!(
            "  {:<44} median {:>10.3} µs   p95 {:>10.3} µs   min {:>10.3} µs",
            self.label,
            self.median / 1000.0,
            self.p95 / 1000.0,
            self.min / 1000.0
        );
    }
}

/// Measures one operation under the ADR-0002 §8.5 method.
///
/// `batch` is how many operations one iteration performs. Sub-microsecond
/// operations are timed in batches because the clock's resolution is a
/// meaningful fraction of the thing being measured, and a per-operation timing
/// would report the timer.
fn measure(label: &'static str, batch: usize, mut operation: impl FnMut()) -> Measurement {
    let mut run_medians = Vec::with_capacity(RUNS);
    let mut all_samples = Vec::with_capacity(RUNS * ITERATIONS);

    for _ in 0..RUNS {
        for _ in 0..WARM_UPS {
            for _ in 0..batch {
                operation();
            }
        }

        let mut samples = Vec::with_capacity(ITERATIONS);
        for _ in 0..ITERATIONS {
            let started = Instant::now();
            for _ in 0..batch {
                operation();
            }
            let elapsed = started.elapsed();
            #[allow(clippy::cast_precision_loss)]
            samples.push(elapsed.as_nanos() as f64 / batch as f64);
        }

        all_samples.extend(samples.iter().copied());
        run_medians.push(percentile(&mut samples, 0.5));
    }

    Measurement {
        label,
        median: percentile(&mut run_medians, 0.5),
        p95: percentile(&mut all_samples, 0.95),
        min: all_samples.iter().copied().fold(f64::INFINITY, f64::min),
    }
}

fn percentile(samples: &mut [f64], quantile: f64) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if samples.is_empty() {
        return 0.0;
    }
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss
    )]
    let index = ((samples.len() as f64 - 1.0) * quantile).round() as usize;
    samples[index.min(samples.len() - 1)]
}

#[test]
fn topology_change_costs_what_the_display_subsystem_can_account_for() {
    let docked = Topology::new(reference_displays());
    let undocked = Topology::new(vec![reference_displays()
        .into_iter()
        .next()
        .expect("three displays")]);
    let graph = DisplayGraph::build(Arc::new(docked.clone()));

    let published = SharedTopology::new();
    let mut docking = false;

    let reader = SharedTopology::new();
    reader.publish(docked.clone());

    println!(
        "\nPB-G7 — display subsystem share, {} displays, mixed DPI",
        docked.monitors().len()
    );
    println!("  informational only: not the ADR-0002 §6.1 reference machine (D-2, MM-1)");
    println!(
        "  method: {RUNS} runs × ({WARM_UPS} discarded warm-ups + {ITERATIONS} iterations), MM-11/MM-12\n"
    );

    let measurements = vec![
        measure("fingerprint (persisted layout key)", 200, || {
            std::hint::black_box(docked.fingerprint());
        }),
        measure("diff, docked → undocked", 200, || {
            std::hint::black_box(TopologyDiff::between(&docked, &undocked));
        }),
        measure(
            "graph build (adjacency + bounds + fingerprint)",
            200,
            || {
                std::hint::black_box(DisplayGraph::build(Arc::new(docked.clone())));
            },
        ),
        // Alternating so every iteration is a real change: republishing the same
        // arrangement short-circuits, which would measure the rejection path
        // rather than the work.
        measure("publish (clone + diff + graph + atomic swap)", 100, || {
            docking = !docking;
            let next = if docking {
                docked.clone()
            } else {
                undocked.clone()
            };
            std::hint::black_box(published.publish(next));
        }),
        measure("query: monitor_at", 2000, || {
            std::hint::black_box(graph.monitor_at(PhysicalPoint { x: 5000, y: 900 }));
        }),
        measure("query: nearest (point in no display)", 2000, || {
            std::hint::black_box(graph.nearest(PhysicalPoint { x: -400, y: -400 }));
        }),
        measure("query: neighbor", 2000, || {
            let id = graph.monitors()[0].id();
            std::hint::black_box(graph.neighbor(id, Direction::Right));
        }),
        // The read path every consumer takes, and the only one on a hot path:
        // a read lock held long enough to clone one `Arc`.
        measure("read the published graph", 4000, || {
            std::hint::black_box(reader.graph());
        }),
    ];

    for measurement in &measurements {
        measurement.report();
    }
    println!();

    // Regression guards, not budgets. Each sits far above the measured value:
    // they catch a query that starts cloning the topology or a rebuild that
    // becomes quadratic, and stay quiet on a loaded runner.
    for measurement in &measurements {
        assert!(
            measurement.median < 5_000_000.0,
            "{} took {:.3} ms per operation, which is not a cost this stage can have",
            measurement.label,
            measurement.median / 1_000_000.0
        );
    }

    let total: f64 = measurements.iter().map(|m| m.p95).sum();
    println!(
        "  sum of p95 across every measured operation: {:.3} ms of the PB-G7 400 ms budget\n",
        total / 1_000_000.0
    );
    assert!(
        Duration::from_nanos(total as u64) < Duration::from_millis(40),
        "the display share alone must stay inside a tenth of the PB-G7 budget"
    );
}

/// Enumeration against the machine running this, where the backend implements it.
///
/// This is the one measurement that touches the operating system, and the only
/// one whose cost is not the crate's to control: it is dominated by
/// `QueryDisplayConfig` and one registry read per display.
#[test]
fn enumeration_from_the_real_platform_is_measured_where_it_exists() {
    let backend = devdesk_platform::current_backend();

    if !backend
        .supports(PlatformFeature::MonitorEnumeration)
        .is_available()
    {
        println!("\n  enumeration: unsupported on this platform, nothing to measure\n");
        return;
    }

    let measurement = measure(
        "enumerate (platform → topology, real hardware)",
        1,
        || {
            std::hint::black_box(devdesk_display::enumerate(backend.as_ref()))
                .expect("enumeration must succeed");
        },
    );

    println!("\nPB-G7 — the re-query step, against this machine's displays");
    println!("  informational only: not the ADR-0002 §6.1 reference machine (D-2, MM-1)\n");
    measurement.report();
    println!();

    assert!(
        measurement.median < 250_000_000.0,
        "enumeration took {:.1} ms, which would exceed the WD-6 debounce window it runs after",
        measurement.median / 1_000_000.0
    );
}
