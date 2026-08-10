# Widget scheduler — first recorded measurement

**Date:** 2026-08-08 · **Harness:** `packages/widget-engine/src/scheduler.bench.ts` · **Budgets:** `B-4`, `PB-G7`

## Status: informational, not normative

Taken on a developer machine, not the [`ADR-0002`](../../docs/adr/ADR-0002-performance-budgets.md)
§6.1 reference machine. Under `D-2` and `MM-1` that makes every number here
**informational**: it may not be used to pass, fail, or amend a budget.

Method is `vitest bench` (tinybench), which is not the ADR §8.5 statistic — it
reports its own hz/mean/percentiles over an adaptive sample count. The Rust
suites use the ADR method because they gate; this one exists to answer a design
question and to catch an algorithmic regression, so its numbers are comparable
with each other and not with the reference-machine ones.

## What is being measured

The widget under measurement does close to nothing — `update` returns the
timestamp it was handed. Measuring a realistic widget would report the widget;
what needs watching is **the cost the runtime adds around it**, so a regression
in the scheduler is not hidden behind whatever a clock happens to do.

`NEVER_SUSPEND` is in force for the scheduling benchmarks, so they measure
scheduling rather than the policy deciding to skip everything. The policy's own
cost is measured separately.

Fleet size is 32 widgets — above `ADR-0002`'s W2 workload of 24 surfaces.

## Update latency

| Operation | Mean | p99 |
| --- | ---: | ---: |
| Mark dirty and flush one widget | **2.3 µs** | 4.8 µs |
| Render one widget | **0.3 µs** | 0.5 µs |
| Flush 32 dirty widgets in one pass | **30.0 µs** | 64.8 µs |
| Theme switch across 32 widgets | **14.6 µs** | 28.1 µs |

Per-widget flush cost across the fleet is ~0.94 µs, against 2.3 µs for a single
widget measured alone — the fixed per-pass cost is amortised, and the work is
linear in widget count rather than worse.

## Scheduler overhead

| Operation | Mean | p99 |
| --- | ---: | ---: |
| Coalesce 6 causes into one update | **2.8 µs** | 5.8 µs |
| Idle pass, 32 widgets, nothing dirty | **23.5 µs** | 48.1 µs |
| One second of cadence, 32 widgets | **101.1 µs** | 247.0 µs |
| 32 requests inside one throttle window | **242.4 µs** | 649.1 µs |
| Visibility change across 32 widgets (64 calls) | **419.7 µs** | 969.5 µs |

## What this tells us

**Steady-state idle cost is the headline.** Thirty-two widgets each on a
one-second cadence cost **101 µs per second** — about **0.01% of one core**.
`B-4` budgets idle CPU below 1%, so the scheduler's own contribution is two
orders of magnitude under it. That figure includes one wake-up, 32 policy
evaluations, 32 flushes, and the re-arm.

**A truly idle desktop costs nothing at all.** With no widget declaring a cadence
and nothing dirty, the scheduler holds no timer, so there is no pass to measure.
The 23.5 µs idle-pass figure is what a pass costs *when one happens*, not a
recurring cost.

**Coalescing is worth what it claims.** Six causes folded into one update cost
2.8 µs — essentially the same as the 2.3 µs single-cause flush. Six separate
updates would have cost roughly six times that, and the widget would have
recomputed six times for one moment.

**Theme switching is cheap because the update is deferred.** 14.6 µs across 32
widgets is context rebuilding and dirty-marking only; the widget work happens on
the next pass, coalesced with anything else owed. Applying updates eagerly would
have put 30 µs of widget calls on the same path.

## Two findings worth acting on

**`request` in a loop is the expensive path, and that is why `requestAll`
exists.** 32 individual `request` calls cost 242 µs, against 30 µs to flush the
same 32 widgets. The cost is not the marking — it is that every `request`
re-arms the wake-up, cancelling and re-scheduling a timer each time.
`requestAll` marks the whole set and re-arms once. **Any caller fanning a single
cause across many instances should use it**; a topology change reaching 32
widgets one at a time is the case that would otherwise show up.

**`setVisibility` has the same shape**, at ~6.5 µs per call, for the same reason
— it applies the policy and re-arms per instance. There is no batched
equivalent yet. It has not needed one: visibility changes arrive one surface at
a time from the window subsystem. If a future occlusion pass ever changes many
at once, it wants a `setVisibilityAll` built the way `requestAll` is.

Neither is a correctness problem and neither is on a frame path. Both are
recorded so the next person measuring does not rediscover them.

## Design consequences

- **Moving cadence out of widgets was the right call, and this is the evidence.**
  32 widgets holding their own `setInterval` would be 32 wake-ups a second
  instead of one. The per-wake-up cost is not the concern — the concern is that
  nothing could then decline to run them when hidden, which is precisely what
  the 0.01% figure depends on.
- **The pure `update`/`render` split pays for itself.** Render at 0.3 µs is
  cheap enough that re-rendering on any doubt costs nothing, and `update`
  returning its own state to signal "nothing changed" skips even that.
- **Nothing here justifies optimisation work.** The two findings above are
  documented shapes, not regressions, and the numbers sit far below every budget
  they touch.
