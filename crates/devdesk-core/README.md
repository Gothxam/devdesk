# `devdesk-core`

**Layer:** Rust core — kernel · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

The authoritative application state graph, actor supervision, the event bus, and transaction/journal semantics.

### Window subsystem (`src/window/`)

Surface lifecycle, monitor association, reveal state, and the window visibility
commands the host executes. It is the core's single consumer of
`devdesk-display` (`ADR-0004` `ARCH-1`) — nothing else in the window or layout
path reaches back to the display crate or to a `PlatformBackend`.

```text
DisplayGraph → WindowManager → SurfaceManager → RevealStateMachine
 (immutable)    which display    which surfaces      when visible
                      ↓
       WindowOutcome { events, commands }
                      ↓
                SurfaceHost ──sink──▶ apps/desktop (Tauri)
```

**Nothing here knows what Tauri is.** `WindowManager` decides what should be
true and emits `WindowCommand`s; a `WindowCommandSink` implemented in
`apps/desktop` performs them. That split is what lets association, the reveal
sequence, and the no-flash invariant be tested without a display server — the
invariants are asserted over a recorded list of commands rather than observed on
a running window.

#### The invariant

> A surface **MUST NOT** become visible before its first frame is ready
> (`AC-FRE-1.1`).

It holds structurally, not by discipline. `CreateHidden` carries no `visible`
field, so the flash is not a choice a caller can make wrong. `Show` is produced
in one place, reachable only from the transition into `Revealed`, which is
reachable only from `FirstFrameReady`.

#### Two things that are easy to get wrong

**A surface that has painted is *owed* a show; it is not necessarily shown.**
Reaching `Revealed` and issuing the command are separate events, because a
surface can paint while no display is attached, and because the windowing system
can refuse. The debt is recorded on the record (`is_show_pending`) and
discharged by the next association that gives the surface a display.

**Failure handling is deliberately asymmetric.** A failed *create* is rolled
back — nothing exists yet, and leaving the surface registered would hold its
identity against a window that was never made, so a retry would fail as a
duplicate. A failed *show* is not rolled back — reverting to `FirstFrameReady`
would have the next frame signal reveal again, retrying forever against a window
that will not show. A *removal* commits regardless, because keeping a surface
the user deleted would resurrect it on the next arrangement restore.

#### Locking

`SurfaceHost` holds its state lock **across** the sink calls. Computing under
the lock and dispatching outside it looks cheaper and is wrong: two threads can
compute in one order and dispatch in the other, so a show can reach the
windowing system before the create that makes its window. Window creation
therefore serialises, which is the right trade — it happens at startup and on
user action, never in a frame.

#### Identity lifetimes

`SurfaceId` is persisted; it is what an arrangement binds to. `WindowId` is
process-local, monotonic, never reused, and derives no `serde` — the same
doctrine `ADR-0004` `TP-14` applies to a topology generation, for the same
reason: a stored one would still *compare*.

#### Tests

| Suite | Covers |
| --- | --- |
| `src/window/tests/` | Each piece against its own contract |
| `tests/integration/window_lifecycle.rs` | The path where everything works |
| `tests/integration/window_races.rs` | Concurrency and interleaving |
| `tests/integration/window_recovery.rs` | Failure, removal, and reuse |
| `tests/integration/window_properties.rs` | Eight invariants over generated sequences |
| `tests/perf/window.bench.rs` | Reveal, publish, association, 32-surface startup |

## Does not own

Any OS API call, any serialization format, any UI concept.

Window placement. The window subsystem answers *which display* a surface belongs
to; it computes no coordinate, size, or anchor, and it holds no snapping,
z-order, or layer policy. That boundary is `ADR-0004` §4.3, moved up one layer.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
