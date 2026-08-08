# Display topology — first recorded measurement

**Date:** 2026-08-08 · **Harness:** `tests/perf/topology.bench.rs` · **Budget:** `PB-G7`

## Status: informational, not normative

This was taken on a developer machine, not the [`ADR-0002`](../../docs/adr/ADR-0002-performance-budgets.md)
§6.1 reference machine, which is commissioned later in Sprint 1. Under `D-2` and
`MM-1` that makes every number here **informational**: it may not be used to
pass, fail, or amend a budget.

It is recorded anyway because the shape is what matters at this stage — whether
the display subsystem's share of `PB-G7` is a rounding error or a problem — and
that answer does not depend on the machine.

The statistical method **is** the ADR's: `MM-11`'s 20 iterations after 3
discarded warm-ups, `MM-12`'s median of three independent runs. A
developer-machine number taken a different way could not be compared with the
reference-machine number that will replace it.

## Environment

| Field | Value |
| --- | --- |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Toolchain | `1.97.1`, `x86_64-pc-windows-msvc` |
| Profile | `release` (`lto = true`, `codegen-units = 1`) |
| Attached displays | 2 (one 2560×1440 primary, one secondary), both 100% |
| Synthetic fixture | 3 displays, mixed DPI — 2560×1440 @ 100%, 1920×1080 @ 100%, 3840×2160 @ 150% |

Mixed DPI in the fixture is mandatory (`TS-5`, `WD-2`): a uniform-DPI fixture
cannot detect the largest defect class in this system (`AP-6`).

## `PB-G7` — display subsystem share

`PB-G7` budgets topology change → layout reapplied → all surfaces repainted at
≤ 400 ms p95, measured after the 250 ms `WD-6` debounce. Layout and repaint do
not exist yet; this is the part that does.

| Operation | Median | p95 | Min |
| --- | ---: | ---: | ---: |
| `fingerprint` (persisted layout key) | 0.404 µs | 0.467 µs | 0.404 µs |
| `TopologyDiff::between`, docked → undocked | 0.408 µs | 0.411 µs | 0.407 µs |
| `DisplayGraph::build` (adjacency + bounds + fingerprint) | 3.261 µs | 4.482 µs | 3.221 µs |
| `SharedTopology::publish` (clone + diff + graph + swap) | 3.229 µs | 5.377 µs | 3.097 µs |
| Query: `monitor_at` | 0.003 µs | 0.003 µs | 0.003 µs |
| Query: `nearest` (point in no display) | 0.013 µs | 0.017 µs | 0.013 µs |
| Query: `neighbor` | 0.014 µs | 0.014 µs | 0.013 µs |
| Read the published graph (read lock + `Arc` clone) | 0.016 µs | 0.016 µs | 0.016 µs |

**Sum of p95 across every operation: 0.011 ms of the 400 ms budget.**

## The re-query step, against real hardware

| Operation | Median | p95 | Min |
| --- | ---: | ---: | ---: |
| `enumerate` — platform → topology, 2 real displays | 285.6 µs | 367.7 µs | 268.2 µs |

This is the only measurement that touches the operating system and the only cost
not the crate's to control. It is dominated by `QueryDisplayConfig` plus one
registry read per display for the EDID serial.

At 0.29 ms it is 0.07% of `PB-G7`, which settles the question the EDID read
raised: reading a serial per display costs nothing against a budget that runs
after a 250 ms debounce, and it buys the only identity signal that survives a
display being moved to another port.

## What this tells us

The display subsystem is not where `PB-G7` will be spent. The whole path
measured here — re-query, diff, rebuild, and every query a layout pass will make
— is roughly **0.3 ms against a 400 ms budget**, so essentially all of `PB-G7`
belongs to layout solving and repaint, neither of which exists yet.

That has one design consequence worth recording: rebuilding the `DisplayGraph`
on every topology change, rather than mutating it, costs about 3 µs. The
immutability guarantee it buys — a consumer mid-drag holding one internally
consistent desktop — is therefore free in any sense that matters, and there is
no case for revisiting it on performance grounds.

The debug-profile numbers are 2–5× higher across the board (enumeration 377 µs,
publish 10 µs) and are recorded here only to note that the harness's regression
guards are set high enough to stay quiet in either profile.
