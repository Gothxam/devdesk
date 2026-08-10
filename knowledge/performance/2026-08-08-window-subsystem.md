# Window subsystem — first recorded measurement

**Date:** 2026-08-08 · **Harness:** `tests/perf/window.bench.rs` · **Budgets:** `PB-R6`, `PB-G7`

## Status: informational, not normative

Taken on a developer machine, not the [`ADR-0002`](../../docs/adr/ADR-0002-performance-budgets.md)
§6.1 reference machine. Under `D-2` and `MM-1` that makes every number here
**informational**: it may not be used to pass, fail, or amend a budget.

The method is the ADR's — `MM-11`'s 20 iterations after 3 discarded warm-ups,
`MM-12`'s median of three independent runs — so these stay comparable with the
reference-machine numbers that will replace them.

## What is and is not being measured

The sink is a recording one. **This measures the window subsystem, not the
windowing system.** That is the point: `PB-R6` (surface show, hidden → first
frame, ≤ 100 ms p95) is dominated by webview startup, which this crate neither
controls nor can speed up. Mixing the two would hide a regression in the part
that is ours behind noise in the part that is not.

So the question these answer is narrower and more useful: *how much of the
budget is gone before the windowing system is even asked?*

## Environment

| Field | Value |
| --- | --- |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Toolchain | `1.97.1`, `x86_64-pc-windows-msvc` |
| Fixture | 8 surfaces, 2 displays, mixed DPI (100% and 150%) |

## Release profile

| Operation | Median | p95 | Min |
| --- | ---: | ---: | ---: |
| Reveal: first frame → show dispatched | 1.400 µs | 1.700 µs | 1.300 µs |
| Topology publish → adopted and re-associated (8 surfaces) | 8.218 µs | 10.112 µs | 7.702 µs |
| Association: assign one surface to a display | 0.557 µs | 0.667 µs | 0.546 µs |
| Startup: 32 surfaces registered and revealed concurrently | 3.448 ms | 4.195 ms | 3.127 ms |

## Debug profile

Recorded because the gate runs the suite in debug, and the regression guards
have to stay quiet in both.

| Operation | Median | p95 |
| --- | ---: | ---: |
| Reveal | 4.400 µs | 4.700 µs |
| Topology publish | 29.360 µs | 35.526 µs |
| Association | 2.058 µs | 3.325 µs |
| 32-surface startup | 4.384 ms | 5.078 ms |

## What this tells us

**Reveal is free.** 1.4 µs against `PB-R6`'s 100 ms is 0.0014% of the budget.
Everything `PB-R6` costs is webview startup and first paint. If that budget is
ever missed, this subsystem is not where to look — and now there is a number
saying so rather than an assumption.

**A topology change costs 8 µs for 8 surfaces**, on top of the ~0.3 ms the
display subsystem spends re-querying
([2026-08-08-display-topology.md](./2026-08-08-display-topology.md)). Roughly 1
µs per surface, so the association pass is linear in surfaces, as intended. At a
realistic 24 surfaces this is ~25 µs of `PB-G7`'s 400 ms.

**The 32-surface concurrency number is dominated by thread creation, not by the
subsystem.** 32 `std::thread::spawn` calls on Windows cost roughly 100 µs each,
which accounts for most of the 3.4 ms; the debug-profile figure is only 27%
higher than release, which is what a thread-spawn-bound measurement looks like
rather than a compute-bound one. The number is recorded as an **upper bound** on
a startup fan-out — real startup does not spawn a thread per surface — and the
subsystem's own share is closer to the 1.4 µs reveal figure times 32.

That also means it is the wrong measurement to watch for lock contention. If
serialising dispatch (`c8a4cdb`) ever becomes a bottleneck, this benchmark will
not be what shows it; a measurement with a slow sink would.

## Design consequences

- **Holding the state lock across sink dispatch costs nothing measurable here.**
  It was adopted to close a command-reordering race, and the concern that it
  would serialise startup is not visible against thread-creation cost. It should
  be revisited only if a real sink's `execute` becomes slow — Tauri window
  creation is the candidate — and the honest way to check that is a benchmark
  with a deliberately slow sink, which does not exist yet.
- **Association being linear is worth keeping.** The re-association pass walks
  every surface on every topology adoption, and a second pass settles owed
  shows. Both are O(surfaces); neither became quadratic when the pending-show
  pass was added, which is what the ~1 µs-per-surface figure confirms.
