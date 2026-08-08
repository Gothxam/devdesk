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
