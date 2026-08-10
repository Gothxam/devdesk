# Composition layer — first recorded measurement

**Date:** 2026-08-08 · **Harness:** `packages/widget-engine/src/composition/composition.bench.ts` · **Budgets:** `PB-R2` (frame), `B-8`

## Status: informational, not normative

Developer machine, not the [`ADR-0002`](../../docs/adr/ADR-0002-performance-budgets.md)
§6.1 reference machine; tinybench, not the §8.5 statistic. Under `D-2`/`MM-1`
these numbers may not pass, fail, or amend a budget. They exist to answer design
questions and to catch algorithmic regressions.

Fleet sizes bracket W2 (24 surfaces): 8, 32, and 128. Surfaces overlap
deliberately so hit-testing and occlusion see stacked surfaces rather than a
disjoint grid that flatters them.

## Composition overhead

| Operation | 8 surfaces | 32 surfaces | 128 surfaces |
| --- | ---: | ---: | ---: |
| Build a scene from scratch | 4.7 µs | 25.9 µs | 125.7 µs |
| Replace one surface | 5.1 µs | 26.2 µs | 109.3 µs |
| Hit test (hit) | 0.7 µs | 0.6 µs | 2.0 µs |
| Hit test (miss) | 0.6 µs | 2.5 µs | 10.1 µs |
| Every surface under a point | 1.2 µs | 3.1 µs | 9.3 µs |
| Occlusion cull | 2.3 µs | 20.6 µs | 338.7 µs |

## Invalidation cost

| Operation | 8 | 32 | 128 |
| --- | ---: | ---: | ---: |
| Diff two identical scenes | 3.4 µs | 11.0 µs | 51.1 µs |
| Diff after one surface moved | 6.0 µs | 16.3 µs | 49.8 µs |
| Diff after every surface moved | 24.3 µs | 88.1 µs | 389.5 µs |
| Merge two invalidations | 5.8 µs | 11.6 µs | 32.7 µs |

**End to end:** a drag frame — 10 scene updates coalesced into 1 presented
frame, 32 surfaces — costs **1.0 ms** mean, which is the whole pipeline
(10 diffs + merges + one occlusion cull + present) inside a 16.6 ms frame with
15 ms to spare.

## What this tells us

**At W2 scale, everything is sub-frame by two orders of magnitude.** The worst
single number at 32 surfaces is the every-surface-moved diff at 88 µs — 0.5% of
a 60 Hz frame. The design questions this suite existed to answer come back
clean: immutable scenes are affordable, diff-based invalidation is affordable,
and the drag path holds a frame with room.

**Replace-one-surface costs the same as build-from-scratch.** Expected: `with()`
rebuilds the map and re-sorts. At 26 µs for 32 surfaces this is fine for what
scenes do today (change on user action, not per frame). If a drag path ever
feeds per-mousemove scene updates at 128+ surfaces, an incremental scene —
patching the sorted array instead of re-sorting — is the known fix, and this
row is its before-number.

**Occlusion cull is the one super-linear row.** 2.3 → 20.6 → 338.7 µs is the
pairwise check against accumulated occluders showing its O(n·k) shape. At W2 it
is irrelevant; at 128 overlapping surfaces it is a third of a millisecond, still
sub-frame. It runs once per presented frame, not per update. If it ever matters,
the fix is culling per-monitor (k drops to the occluders on one display), which
the data model already supports.

**Diffing an unchanged scene is not free — 11 µs at 32 — but the compositor
never does it blind.** `update()` diffs only when handed a new scene; an
identical rebuild is caught by the value-equality check and dropped without
scheduling a frame. The steady-state desktop performs zero diffs.

## Design consequences

- **Immutability holds at this scale.** The whole argument for immutable scenes
  (hit tests and frames reading one consistent desktop) costs ~26 µs per scene
  change at W2. No shared-mutable-scene design is justified by these numbers.
- **The frame scheduler's coalescing does its job:** ten updates, one frame, and
  the merged invalidation reports the full distance travelled. The 1.0 ms drag
  frame is the proof.
- **Nothing here justifies optimisation now.** Both flagged shapes (rebuild-on-
  replace, occlusion growth) have known fixes recorded against their trigger
  conditions, neither of which M0–M1 reaches.
