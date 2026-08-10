# AI Agent Session History

*This log records every AI agent interaction, decisions made, files changed, and next steps.*

---

## 📅 Session Log: 2026-08-07

- **Agent**: Antigravity (Google DeepMind)
- **Task**: Monorepo Initialization, Governance & Structure Setup
- **Files Changed**:
  - `README.md`, `.ai/CONTEXT.md`, `.ai/AGENTS.md`, `.ai/IMPLEMENTATION_RULES.md`
  - `governance/` (`PROJECT_CONSTITUTION.md`, `ARCHITECTURE_PRINCIPLES.md`, `DECISION_PROCESS.md`, `VERSIONING.md`)
  - `planning/` (`brainstorm.md`, `future.md`, `backlog.md`, `ideas.md`, `meeting-notes.md`)
  - `configs/`, `packages/`, `playground/`, `docs/`, `knowledge/`, `.github/`
- **Decisions Made**:
  - Established 3 Sources of Truth (`docs/` specs, `knowledge/` research, `.ai/` AI context).
  - Defined Three Levels of Abstraction (Level 1: Vision, Level 2: Architecture, Level 3: Implementation).
  - Configured GitHub labels, milestones, and pull request templates.
  - Implemented strict Git workflow (Issue ➔ Branch ➔ PR ➔ Review ➔ Merge) and mandatory ADR policy.


---

## 📅 Session Log: 2026-08-08

- **Agent**: Antigravity (Google DeepMind)
- **Task**: Rust Environment Setup
- **Files Changed**:
  - `.ai/SESSION.md`
- **Decisions Made**:
  - Installed Rust Toolchain (`rustc 1.97.1`, `cargo 1.97.1`, `rustup 1.29.0`).
  - Installed Visual Studio 2022 C++ Build Tools (`Microsoft.VisualStudio.Workload.VCTools`).
  - Verified MSVC `link.exe` native Rust compilation probe cleanly (`x86_64-pc-windows-msvc`).
- **Next Steps**:
  - Initialize Tauri core engine in `apps/`.




---

## 📅 Session Log: 2026-08-08 — Sprint 1 Day 3 (Display Subsystem)

- **Agent**: Claude Opus 5 (Anthropic) via Claude Code
- **Task**: Sprint 1 commits C17–C19, plus three architectural refinements to the
  display subsystem (confidence-based identity, transactional change events, an
  immutable display graph).
- **Files Changed**:
  - `crates/devdesk-platform/` — `platform.rs`, `feature.rs`, `error.rs`,
    `display.rs`, `backend.rs`, `unsupported.rs`, `win/{mod,monitors,edid,watcher}.rs`,
    `tests.rs`, `Cargo.toml`, `README.md`
  - `crates/devdesk-display/` — `identity.rs`, `hash.rs`, `error.rs`,
    `enumerate.rs`, `graph.rs`, `diff.rs`, `transaction.rs`, `hotplug.rs`,
    `geometry.rs`, `monitor.rs`, `topology.rs`, `tests/`, `Cargo.toml`, `README.md`
  - `tests/perf/topology.bench.rs`, `knowledge/performance/2026-08-08-display-topology.md`
  - Root `Cargo.toml` (the `windows` workspace dependency, SEC-20 justified)
- **Decisions Made**:
  - `PlatformBackend::enumerate_monitors` returns `RawMonitorInfo`, not
    `MonitorDescriptor`. `ADR-0003` §4.1 makes display depend on platform, so a
    domain return type would invert that and put display policy in the OS shim.
    Recorded as a deviation from the illustrative trait in
    `SYSTEM_ARCHITECTURE.md` §19.1, which predates the dependency order.
  - Identity is confidence-based (`Exact`/`Strong`/`Probable`/`Weak`) rather than
    string equality, because no single reported signal is both always present and
    always stable. An ambiguous match resolves to nothing; two absent signals are
    never agreement.
  - Fingerprints and identity keys hash with a pinned FNV-1a, not `DefaultHasher`.
    These values are persisted (`WD-4`) and `DefaultHasher`'s algorithm may change
    between Rust releases, which would orphan every saved layout on a toolchain bump.
  - `WD-2` compliance tightened: scale-taking conversions are now crate-private and
    the public API hangs off `MonitorDescriptor`.
  - `TopologyGeneration` added alongside `TopologyFingerprint`. A fingerprint
    answers *which* arrangement; only a generation answers *how recent*, and
    undock/redock returns to a fingerprint already seen.
- **Next Steps**:
  - C20 (`feat(app): create surface windows hidden and show on first frame`) is
    open pending a scope decision — it is `feat(app)`, not display.
  - Day 4 — widget runtime (C21–C25).


---

## 📅 Session Log: 2026-08-08 — Sprint 1 Day 4 (Window Subsystem)

- **Agent**: Claude Opus 5 (Anthropic) via Claude Code
- **Task**: `ADR-0004` and its Amendment 1, then Sprint 1 commits C20–C24 — the
  window subsystem: `WindowId`, `SurfaceId`, `WindowManager`, `SurfaceManager`,
  `RevealStateMachine`, hidden surface creation.
- **Files Changed**:
  - `docs/adr/ADR-0004-display-topology-identity-and-transaction-model.md` (new)
  - `docs/architecture/SYSTEM_ARCHITECTURE.md` — §9.3 `WD-3`, §9.5 (new
    `WD-10`…`WD-12`), §19.1, §23 `DD-009`, §27.3, §28 glossary
  - `docs/adr/ADR-0001-system-architecture.md` — §3.5 `D-10` register
  - `crates/devdesk-core/src/window/` — `id.rs`, `event.rs`, `manager.rs`,
    `surface.rs`, `reveal.rs`, `outcome.rs`, `host.rs`, `tests/`
  - `crates/devdesk-ipc/src/lib.rs` — `surface_report_first_frame`
  - `apps/desktop/src-tauri/src/surface.rs` (new), `lib.rs`
  - `tests/integration/window_lifecycle.rs`
- **Decisions Made**:
  - ADR numbers are allocated in **decision order**, amending `ADR-0001` `D-10`.
    Stage-ordered numbering only works if ADRs are written in stage order, and
    this is a Stage 2 decision written while the Stage 0 ones are outstanding.
    The register had already contradicted itself: `ADR-0001` §3.5 reserved
    `ADR-0007` for topology identity while `SYSTEM_ARCHITECTURE.md` §27.3
    reserved `ADR-0010`.
  - `TopologyGeneration` is process-local and never persisted (Amendment 1,
    `TP-14`). A stored generation is not merely meaningless next launch — it
    still *compares*, so a consumer reasoning about staleness across a restart
    discards the arrangement it just enumerated.
  - `SurfaceId` persists and derives `serde`; `WindowId` does neither. Same
    doctrine as the generation, same reason.
  - `note_first_frame` reveals in the same call. `AC-FRE-1.1` is that a surface
    becomes visible *when* its content is ready; a separate reveal call opens a
    window in which a caller can forget, delay, or reorder it.
  - `WindowCommand::CreateHidden` carries no `visible` field, so the flash is a
    state the system cannot reach rather than a mistake a caller can make.
  - `SurfaceRecord` carries both `monitor` and `preferred`. Collapsing them makes
    an arrangement erode one docking cycle at a time with no step looking wrong.
- **Next Steps**:
  - Day 4.5 — window/display hardening (C25–C29).
  - No surface is created at startup; first-run arrangement is C39.
  - The `TS-5` virtual topology harness (`ADR-0004` §7.3) is still owed at Stage 3.

---

## 📅 Session Log: 2026-08-08 — Sprint 1 Day 4.5 (Window–Display Hardening)

- **Agent**: Claude Opus 5 (Anthropic) via Claude Code
- **Task**: Commits C25–C29 — implementation hardening only. No architecture
  document, ADR, or design document was modified, by instruction.
- **Files Changed**:
  - `crates/devdesk-core/src/window/` — `host.rs`, `manager.rs`, `surface.rs`,
    `outcome.rs`
  - `tests/integration/` — `support.rs`, `window_races.rs`, `window_recovery.rs`,
    `window_properties.rs` (all new), `window_lifecycle.rs`, `README.md`
  - `tests/perf/` — `harness.rs`, `window.bench.rs` (new), `topology.bench.rs`,
    `README.md`
  - `knowledge/performance/2026-08-08-window-subsystem.md` (new)
  - `crates/devdesk-core/README.md`, `crates/devdesk-display/README.md`
- **Decisions Made**:
  - **Two real defects were found and fixed, not just tested around.**
    1. `SurfaceHost` computed under the state lock and dispatched outside it, so
       two threads could compute in one order and dispatch in the other — a show
       reaching the windowing system before the create that makes its window.
       The lock is now held across the sink calls. Window creation serialises,
       which is acceptable: it happens at startup and on user action, never in a
       frame.
    2. A surface could reveal onto a desktop with no displays. Reaching
       `Revealed` is still correct — it *has* painted — but the command now
       waits. A surface that has painted is **owed** a show, and the debt is
       discharged by the next association that gives it a display.
  - The show debt doubles as the recovery path for a refused show: the command is
    confirmed only after the sink accepts it. Recovery is bounded to topology
    adoptions, so a repeated frame signal is still a no-op rather than a retry
    loop against a window that will not show.
  - Failure handling is deliberately asymmetric: a failed create rolls back, a
    failed show does not, and a removal commits regardless. Each is argued in
    `crates/devdesk-core/README.md`.
  - Property tests use a fixed-seed xorshift rather than a dependency. A property
    test that fails once and passes on re-run tells you nothing.
  - The perf method moved to `tests/perf/harness.rs`. Two suites measuring the
    same budget by different methods produce numbers that cannot be compared.
- **Verification**: 82 tests — 43 unit, 8 lifecycle, 10 races, 10 recovery,
  5 property (~250 runs, ~30k generated operations), 2 display bench, 1 window
  bench, plus 78 display and 17 platform unit tests and 53 TypeScript. Gate green.
- **Next Steps**:
  - Day 5 — widget runtime. Nothing in the window subsystem is a prerequisite
    that is still open.
  - The 32-surface benchmark is thread-spawn-bound and is the wrong instrument
    for lock contention; a slow-sink benchmark is owed if dispatch serialisation
    is ever suspected.
  - `TS-5` virtual topology harness still owed at Stage 3.
