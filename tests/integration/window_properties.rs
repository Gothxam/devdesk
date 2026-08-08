//! The window subsystem's invariants, over sequences nobody wrote by hand.
//!
//! The other suites test paths a person thought of. This one generates them:
//! random operations against a real host, with every invariant re-checked after
//! **every** step. What it is good at is the orderings nobody would think to
//! write — a frame arriving between two topology changes, an assignment landing
//! on a display that leaves in the next operation, a surface removed while it is
//! owed a show.
//!
//! ## Deterministic on purpose
//!
//! The generator is a seeded xorshift, not the system RNG, and the seeds are
//! fixed. A property test that fails once and passes on re-run tells you
//! nothing; this one fails the same way every time and prints the seed and the
//! operation index, so the failing sequence can be replayed exactly.
//!
//! ## The invariants
//!
//! | # | Property |
//! | --- | --- |
//! | P1 | No window is shown before it is created |
//! | P2 | No window is created twice, or shown twice |
//! | P3 | A surface is on screen only if it has painted |
//! | P4 | A surface that has painted is either shown or owed a show — never both, never neither |
//! | P5 | A surface's display, if it has one, is attached |
//! | P6 | Live surfaces have distinct window identities |
//! | P7 | The adopted generation never decreases |
//! | P8 | No command addresses a window that was destroyed |
//!
//! EM-1 prohibits unwrap/expect in *non-test* code; a test asserting a
//! precondition is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::Arc;

use devdesk_core::window::{SurfaceHost, SurfaceId, WindowCommand, WindowId};
use devdesk_display::{SharedTopology, Topology, TopologyGeneration, TopologyTransaction};

use support::{dark, docked, external_only, host, replaced, surface, undocked, RecordingSink};

// --------------------------------------------------------------- generator --

/// A seeded xorshift64*. Small, specified, and identical on every machine.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // A zero state is a fixed point for xorshift; the low bit forces it off.
        Self(seed | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            0
        } else {
            usize::try_from(self.next() % bound as u64).unwrap_or(0)
        }
    }
}

/// The arrangements a generated sequence chooses between.
fn arrangements() -> Vec<Topology> {
    vec![docked(), undocked(), external_only(), replaced(), dark()]
}

// -------------------------------------------------------------- invariants --

/// Everything that must be true after every single operation.
///
/// Takes the whole world rather than one piece, because most of these properties
/// relate the recorded commands to the state — and a subsystem can satisfy each
/// half separately while disagreeing between them.
fn check(
    host: &SurfaceHost,
    sink: &RecordingSink,
    highest_generation: &mut TopologyGeneration,
    context: &str,
) {
    let log = sink.log();

    // P1, P2, P8.
    assert!(
        !sink.shown_before_created(),
        "P1 violated {context}: {log:?}"
    );
    assert!(!sink.has_duplicates(), "P2 violated {context}: {log:?}");

    let destroyed = sink.destroyed();
    let mut seen_destroyed: Vec<WindowId> = Vec::new();
    for command in &log {
        if seen_destroyed.contains(&command.window()) {
            panic!("P8 violated {context}: {command:?} after its window was destroyed");
        }
        if let WindowCommand::Destroy { window, .. } = command {
            seen_destroyed.push(*window);
        }
    }

    let shown: Vec<WindowId> = log
        .iter()
        .filter(|command| command.makes_visible())
        .map(WindowCommand::window)
        .collect();

    host.with_manager(|manager| {
        // P7.
        assert!(
            manager.generation() >= *highest_generation,
            "P7 violated {context}: generation went backwards"
        );
        *highest_generation = manager.generation();

        let mut windows: Vec<WindowId> = Vec::new();

        for record in manager.surfaces().iter() {
            let window = record.window();

            // P6.
            assert!(
                !windows.contains(&window),
                "P6 violated {context}: {window} used twice"
            );
            windows.push(window);

            // P3.
            assert!(
                !record.is_visible() || record.reveal_state().has_painted(),
                "P3 violated {context}: visible without painting"
            );

            // P4.
            let was_shown = shown.contains(&window);
            if record.is_visible() {
                assert!(
                    was_shown != record.is_show_pending(),
                    "P4 violated {context}: shown={was_shown} pending={} for {window}",
                    record.is_show_pending()
                );
            } else {
                assert!(
                    !was_shown && !record.is_show_pending(),
                    "P4 violated {context}: unrevealed surface shown or owed a show"
                );
            }

            // P5.
            if let Some(monitor) = record.monitor() {
                assert!(
                    manager.is_attached(monitor),
                    "P5 violated {context}: associated with a display that is not attached"
                );
            }
        }

        // A destroyed window belongs to no live surface.
        for window in &destroyed {
            assert!(
                !windows.contains(window),
                "P8 violated {context}: {window} destroyed but still registered"
            );
        }
    });
}

/// One generated run.
struct Run {
    host: SurfaceHost,
    sink: Arc<RecordingSink>,
    displays: SharedTopology,
    /// Transactions already published, so a run can replay an old one.
    history: Vec<TopologyTransaction>,
    surfaces: Vec<SurfaceId>,
    highest: TopologyGeneration,
}

impl Run {
    fn new(surface_count: usize) -> Self {
        let (host, sink) = host();
        Self {
            host,
            sink,
            displays: SharedTopology::new(),
            history: Vec::new(),
            surfaces: (0..surface_count)
                .map(|index| surface(&format!("surface-{index}")))
                .collect(),
            highest: TopologyGeneration::INITIAL,
        }
    }

    fn check(&mut self, context: &str) {
        check(&self.host, &self.sink, &mut self.highest, context);
    }

    /// Publishes an arrangement and adopts it. Every failure here is a
    /// documented refusal — an unchanged republication, or a stale replay.
    fn publish(&mut self, rng: &mut Rng) {
        let choices = arrangements();
        let index = rng.below(choices.len());
        if let Some(transaction) = self.displays.publish(choices[index].clone()) {
            let _ = self.host.observe(&transaction);
            self.history.push(transaction);
        }
    }

    /// Replays an already-adopted transaction, which must be refused.
    fn replay(&mut self, rng: &mut Rng) {
        if self.history.len() < 2 {
            return;
        }
        let index = rng.below(self.history.len() - 1);
        let stale = self.history[index].clone();
        assert!(
            self.host.observe(&stale).is_err(),
            "a stale transaction was adopted"
        );
    }

    fn pick(&mut self, rng: &mut Rng) -> SurfaceId {
        let index = rng.below(self.surfaces.len());
        self.surfaces[index].clone()
    }
}

/// Runs `steps` random operations, checking every invariant after each one.
fn exercise(seed: u64, steps: usize, operations: &[fn(&mut Run, &mut Rng)]) {
    let mut rng = Rng::new(seed);
    let mut run = Run::new(6);

    run.check(&format!("(seed {seed}, before any operation)"));

    for step in 0..steps {
        let choice = rng.below(operations.len());
        operations[choice](&mut run, &mut rng);
        run.check(&format!("(seed {seed}, step {step}, op {choice})"));
    }
}

// ---------------------------------------------------------------- topology --

#[test]
fn arbitrary_topology_sequences_preserve_every_invariant() {
    // Surfaces exist and progress, but the generated operations are all
    // display churn: docking, undocking, blackouts, and whole-set replacements,
    // plus stale replays.
    fn publish(run: &mut Run, rng: &mut Rng) {
        run.publish(rng);
    }
    fn replay(run: &mut Run, rng: &mut Rng) {
        run.replay(rng);
    }
    fn advance(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.register(id.clone());
        let _ = run.host.report_window_created(&id);
        let _ = run.host.report_first_frame(&id);
    }

    for seed in 1..=64 {
        exercise(seed, 80, &[publish, publish, replay, advance]);
    }
}

// ------------------------------------------------------------------ reveal --

#[test]
fn arbitrary_reveal_sequences_never_show_an_unpainted_surface() {
    // Every reveal step in every order, including steps repeated and steps
    // skipped, against a desktop that is also changing.
    fn register(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.register(id);
    }
    fn window_created(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.report_window_created(&id);
    }
    fn first_frame(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.report_first_frame(&id);
    }
    fn remove(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.remove(&id);
    }
    fn publish(run: &mut Run, rng: &mut Rng) {
        run.publish(rng);
    }

    for seed in 1..=64 {
        exercise(
            seed,
            120,
            &[
                register,
                window_created,
                first_frame,
                first_frame,
                remove,
                publish,
            ],
        );
    }
}

// -------------------------------------------------------------- assignment --

#[test]
fn arbitrary_assignment_sequences_leave_a_consistent_association() {
    // Assignment refuses a display that is not attached, so most generated
    // assignments fail — which is the point. The ones that land must never
    // leave a surface pointing at a display that has gone.
    fn assign(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let monitors: Vec<_> = run.host.with_manager(|manager| {
            manager
                .graph()
                .monitors()
                .iter()
                .map(|monitor| monitor.id().clone())
                .collect()
        });
        if monitors.is_empty() {
            return;
        }
        let index = rng.below(monitors.len());
        let _ = run.host.assign(&id, &monitors[index]);
    }
    fn register(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.register(id);
    }
    fn reveal(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.report_window_created(&id);
        let _ = run.host.report_first_frame(&id);
    }
    fn publish(run: &mut Run, rng: &mut Rng) {
        run.publish(rng);
    }

    for seed in 1..=64 {
        exercise(seed, 100, &[register, assign, assign, reveal, publish]);
    }
}

// ------------------------------------------------------------------ mixture --

#[test]
fn arbitrary_mixed_sequences_preserve_every_invariant() {
    // Everything at once, over longer runs. This is the one that finds the
    // interactions the single-axis tests cannot.
    fn register(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.register(id);
    }
    fn window_created(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.report_window_created(&id);
    }
    fn first_frame(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.report_first_frame(&id);
    }
    fn remove(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let _ = run.host.remove(&id);
    }
    fn assign(run: &mut Run, rng: &mut Rng) {
        let id = run.pick(rng);
        let monitors: Vec<_> = run.host.with_manager(|manager| {
            manager
                .graph()
                .monitors()
                .iter()
                .map(|monitor| monitor.id().clone())
                .collect()
        });
        if monitors.is_empty() {
            return;
        }
        let index = rng.below(monitors.len());
        let _ = run.host.assign(&id, &monitors[index]);
    }
    fn publish(run: &mut Run, rng: &mut Rng) {
        run.publish(rng);
    }
    fn replay(run: &mut Run, rng: &mut Rng) {
        run.replay(rng);
    }
    fn refuse_create(run: &mut Run, _rng: &mut Rng) {
        // Flip the windowing system into refusing, so rollback and recovery are
        // part of the generated space rather than tested only in isolation.
        let refusing = run.sink.count(|_| true).is_multiple_of(7);
        run.sink.set_fail_create(refusing);
    }
    fn refuse_show(run: &mut Run, _rng: &mut Rng) {
        let refusing = run.sink.count(|_| true).is_multiple_of(5);
        run.sink.set_fail_show(refusing);
    }

    for seed in 1..=48 {
        exercise(
            seed,
            200,
            &[
                register,
                window_created,
                first_frame,
                remove,
                assign,
                publish,
                replay,
                refuse_create,
                refuse_show,
            ],
        );
    }
}

#[test]
fn a_settled_desktop_owes_no_shows() {
    // The closing property: however a run got here, publishing an arrangement
    // with displays discharges every outstanding show, and every surface that
    // has painted is on screen exactly once.
    for seed in 1..=32 {
        let mut rng = Rng::new(seed);
        let mut run = Run::new(6);

        for _ in 0..150 {
            let choice = rng.below(4);
            match choice {
                0 => {
                    let id = run.pick(&mut rng);
                    let _ = run.host.register(id);
                }
                1 => {
                    let id = run.pick(&mut rng);
                    let _ = run.host.report_window_created(&id);
                }
                2 => {
                    let id = run.pick(&mut rng);
                    let _ = run.host.report_first_frame(&id);
                }
                _ => run.publish(&mut rng),
            }
        }

        // Settle on a desktop that has displays. Two arrangements rather than
        // one, because republishing the arrangement already in force yields
        // nothing to adopt — and it is the adoption that discharges the debts.
        for settled in [docked(), undocked()] {
            if let Some(transaction) = run.displays.publish(settled) {
                let _ = run.host.observe(&transaction);
            }
        }

        run.check(&format!("(seed {seed}, settled)"));
        run.host.with_manager(|manager| {
            assert!(
                manager.surfaces().awaiting_show().is_empty(),
                "seed {seed}: {} shows still owed on a desktop with displays",
                manager.surfaces().awaiting_show().len()
            );
        });
    }
}
