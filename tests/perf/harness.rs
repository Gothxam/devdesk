//! The measurement method the performance suites share.
//!
//! `ADR-0002` §8.5 fixes it: `MM-11`'s 20 iterations after 3 discarded warm-ups,
//! `MM-12`'s median of three independent runs. It lives here rather than in each
//! bench because two suites measuring the same budget by different methods
//! cannot be compared — which is the whole point of having a method.
//!
//! **Nothing measured through this harness is normative unless it was taken on
//! the `ADR-0002` §6.1 reference machine** under its environmental controls
//! (`D-2`, `MM-1`). On any other machine the numbers are informational, and the
//! suites say so in their own output.
#![allow(dead_code)]

use std::time::Instant;

/// MM-11: iterations per run, after the discarded warm-ups.
pub const ITERATIONS: usize = 20;
/// MM-11: warm-up iterations, discarded.
pub const WARM_UPS: usize = 3;
/// MM-12: independent runs, of whose medians the median is reported.
pub const RUNS: usize = 3;

/// One measured operation's timings, in nanoseconds per operation.
pub struct Measurement {
    pub label: &'static str,
    pub median: f64,
    pub p95: f64,
    pub min: f64,
}

impl Measurement {
    pub fn report(&self) {
        println!(
            "  {:<46} median {:>10.3} µs   p95 {:>10.3} µs   min {:>10.3} µs",
            self.label,
            self.median / 1000.0,
            self.p95 / 1000.0,
            self.min / 1000.0
        );
    }
}

/// Prints the header every performance suite must carry.
pub fn preamble(title: &str) {
    println!("\n{title}");
    println!("  informational only: not the ADR-0002 §6.1 reference machine (D-2, MM-1)");
    println!(
        "  method: {RUNS} runs × ({WARM_UPS} discarded warm-ups + {ITERATIONS} iterations), MM-11/MM-12\n"
    );
}

/// Measures one operation under the ADR-0002 §8.5 method.
///
/// `batch` is how many operations one iteration performs. Sub-microsecond
/// operations are timed in batches because the clock's resolution is a
/// meaningful fraction of the thing being measured, and a per-operation timing
/// would report the timer.
pub fn measure(label: &'static str, batch: usize, mut operation: impl FnMut()) -> Measurement {
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

/// Measures an operation that has to be set up fresh each time.
///
/// The setup is excluded from the timing, which is the only way to measure
/// something like "reveal one surface" — the surface has to be registered and
/// its window reported first, and folding that in would report the wrong thing.
pub fn measure_prepared<T>(
    label: &'static str,
    mut prepare: impl FnMut() -> T,
    mut operation: impl FnMut(&mut T),
) -> Measurement {
    let mut run_medians = Vec::with_capacity(RUNS);
    let mut all_samples = Vec::with_capacity(RUNS * ITERATIONS);

    for _ in 0..RUNS {
        for _ in 0..WARM_UPS {
            let mut state = prepare();
            operation(&mut state);
        }

        let mut samples = Vec::with_capacity(ITERATIONS);
        for _ in 0..ITERATIONS {
            let mut state = prepare();
            let started = Instant::now();
            operation(&mut state);
            let elapsed = started.elapsed();
            #[allow(clippy::cast_precision_loss)]
            samples.push(elapsed.as_nanos() as f64);
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

pub fn percentile(samples: &mut [f64], quantile: f64) -> f64 {
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
