# `tests/perf/`

Budget harnesses for [`ADR-0002`](../../docs/adr/ADR-0002-performance-budgets.md).

## The reference machine

**Defined in ADR-0002 §6.1. Not restated here.**

This is deliberate (ADR-0002 RP-4, CR-9): two definitions of the measurement
machine is the same class of defect as a hand-written contract mirror (AP-13) —
they drift, and the drift is silent. One definition, one home, referenced from
everywhere else.

The same applies to the workload profiles W0–W3 (§6.2), the metric definitions
(§8), and the statistical method (§8.5).

## What makes a measurement normative

A number is a budget measurement only if it was produced on the reference
machine under its environmental controls, at a named workload, by the harness
ADR-0002 §7 names, using the §8.5 statistic. **Everything else — including every
measurement on a developer machine — is informational** (ADR-0002 MM-1).

## Where results go

`knowledge/performance/`. Measurement data never lives in `docs/`
(PROJECT_CONSTITUTION §2), and it never lives here.

## The shared harness

`harness.rs` implements the ADR-0002 §8.5 method once — `MM-11`'s 20 iterations
after 3 discarded warm-ups, `MM-12`'s median of three independent runs — and
every suite includes it with `#[path]`. It is not a convenience: two suites
measuring the same budget by different methods produce numbers that cannot be
compared, which defeats the purpose of naming a method at all.

`measure` times an operation in batches, for operations fast enough that the
clock's resolution would otherwise be a meaningful fraction of the result.
`measure_prepared` times an operation that needs fresh setup each iteration and
excludes the setup — the only way to measure something that happens once per
subject, such as revealing a surface, where a batch would measure the no-op that
the second call correctly is.

## Suites

| Suite | Budget | Measures |
| --- | --- | --- |
| `topology.bench.rs` | `PB-G7` | Fingerprint, diff, graph build, publish, spatial queries, real enumeration |
| `window.bench.rs` | `PB-R6`, `PB-G7` | Reveal, topology adoption, association, 32-surface startup |

Both are wired as `[[test]]` targets on the crate they exercise, so `cargo test
--workspace` runs them and the assertions act as regression guards. Those
assertions sit far above the measured values on purpose: they catch an
algorithmic regression, not wall-clock drift, which would be flaky on a loaded
runner and is the reference runner's job to gate.
