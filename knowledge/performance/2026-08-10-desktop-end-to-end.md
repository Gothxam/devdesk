# Composed desktop — end-to-end frame latency

**Date:** 2026-08-10 · **Harness:** `apps/desktop/src/desktop/latency.bench.ts` · **Budgets:** `PB-R2`, `B-4`

## Status: informational, not normative

Developer machine, not the [`ADR-0002`](../../docs/adr/ADR-0002-performance-budgets.md)
§6.1 reference machine; tinybench, not the §8.5 statistic. Under `D-2`/`MM-1`
these may not pass, fail, or amend a budget.

## What "end to end" covers, and what it does not

From a cause entering the pipeline to `onFrame` being called, through every real
component: widget host, scheduler, composition scene, invalidation, occlusion
cull, compositor.

**React's commit and the browser's paint are not in these numbers.** The
benchmark runs in Node; there is no DOM. So this measures the part DevDesk owns
and can regress, not the part the browser owns. Worth stating because
"end-to-end frame latency" reads as though it includes the paint.

Fixture: the real `DesktopController` with three clocks placed and revealed, on
a glass theme so a switch actually changes the composition.

## Measurements

| Path | Mean | p99 |
| --- | ---: | ---: |
| Theme switch → frame presented | **22.7 µs** | 93.5 µs |
| One second of clock cadence → views updated | **16.8 µs** | 49.7 µs |
| Hit test through the composed scene | **0.4 µs** | 0.8 µs |
| Present a frame with nothing owed | **0.2 µs** | 0.3 µs |

## What this tells us

**A theme switch costs 22.7 µs of the 16.6 ms frame — 0.14%.** That path is the
widest one the prototype has: three contexts rebuilt, three widgets marked
dirty, the scene rebuilt with new glass, an invalidation diffed, occlusion
culled, and a frame presented. Everything after it is React's.

**A second of clock cadence costs 16.8 µs and presents no frame at all.** Three
clocks tick, three views change, and the compositor is not involved — because
the clocks' *content* changed and the composition did not. That separation is
what the architecture rests on, and this is the number that shows it holding:
the desktop's steady-state cost is widget work, not composition work.

**Hit testing is 0.4 µs**, so routing input through the compositor rather than
the DOM costs nothing worth measuring. That was the design question behind
routing clicks through the scene, and it is answered.

**An unowed frame is 0.2 µs.** Asking for a frame when nothing changed is
effectively free, so a caller need not track whether it should.

## Against the budgets

- **`PB-R2`** (frame, ≤ 16.6 ms at 60 Hz): the widest measured path uses 0.14%.
  Whatever eventually threatens this budget, it will not be the composition
  pipeline.
- **`B-4`** (idle CPU below 1%): a settled desktop with three clocks spends
  16.8 µs per second — about 0.0017% of one core. The earlier scheduler
  measurement said 101 µs/s for 32 widgets; this confirms the same shape at the
  prototype's size, now with composition in the path.

## What is still unmeasured

- **React commit and browser paint.** The other half of a real frame. Measuring
  it needs the app running under a browser harness, which does not exist yet.
- **Real display enumeration in the loop.** `display_describe` is called once at
  startup and never in a frame, so it is deliberately outside this suite; its
  cost is in [2026-08-08-display-topology.md](./2026-08-08-display-topology.md).
- **Per-surface OS windows.** The prototype composes inside one window. The
  real-window path exists and is tested, but its frame cost is a different
  measurement that belongs with the layout engine.
