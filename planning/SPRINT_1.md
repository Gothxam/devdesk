# Sprint 1 — M0 Walking Skeleton

**Goal: a DevDesk build the team can run all day, every day, starting the day this sprint ends.**

> **Scope:** M0 only — the 45 Critical criteria in [`MVP_ACCEPTANCE_MATRIX.md`](../docs/product/MVP_ACCEPTANCE_MATRIX.md) §7.2.
> **This document creates no requirements.** Every criterion comes from [`PRD.md`](../docs/product/PRD.md); every structural decision from [`ADR-0003`](../docs/adr/ADR-0003-repository-layout.md); every Definition-of-Done item from `SYSTEM_ARCHITECTURE.md` §25.4. It sequences existing decisions and nothing else.

---

## Sprint Control

| Field | Value |
| --- | --- |
| **Sprint** | 1 |
| **Milestone** | M0 — Walking Skeleton |
| **Criteria in scope** | 45 (all Critical) |
| **Architecture stages** | 0 → 4 (`SYSTEM_ARCHITECTURE.md` §25.1) |
| **Duration** | 7 focused working days |
| **Exit condition** | §7 — dogfood for one full working day without reaching for a text editor |
| **Out of scope** | §8 — non-negotiable |

**Assumption, stated plainly:** seven days is a tight target for a Rust core, a Tauri host, a React shell, a token pipeline, display topology, drag-and-persist, and Safe Mode. It is achievable with the ADRs already decided — most of Day 1 is executing `ADR-0003` §10.3 rather than designing anything — but **Day 1 and Day 4 are the compression risks**. §6 is the pre-agreed answer if either overruns, so the decision is made now rather than at 9pm on Day 5.

---

## 1. The 45 Criteria, Classified

Tier is already fixed by the matrix — all 45 are Critical. This classification is orthogonal: it answers **what can move if the sprint slips**, and it is the only slip mechanism authorised for this sprint.

| Class | Count | May slip? |
| --- | --- | --- |
| 🧱 **Foundation** | 8 | **Never** — retrofit-impossible |
| 🎨 **Core UX** | 22 | Partially — a named subset only (§6) |
| 🔒 **Security** | 4 | **Never** — retrofit-impossible |
| 🛡️ **Reliability** | 11 | Partially — Safe Mode only (§6) |
| | **45** | |

### 1.1 🧱 Foundation — 8

The substrate. Every one of these is cheap on Day 1 and a rewrite on Day 90.

| Criterion | What it requires |
| --- | --- |
| `AC-KBD-1.1` | Every interactive control maps to a named command; audit finds zero unmapped |
| `AC-KBD-1.2` | The audit runs in CI and blocks merge |
| `AC-KBD-1.4` | Adding a control without a command fails CI, not review |
| `AC-PERF-7.1` | Budgets measured on the ADR-0002 reference machine, not a developer machine |
| `AC-DAT-3.1` | All user data under the current user's application data location |
| `AC-DAT-3.2` | Nothing written system-wide except the autostart registration |
| `AC-OFF-1.1` | Install and first run succeed on a machine with no network adapter |
| `AC-OFF-1.4` | No startup path waits on a network operation |

**Why these are irreducible.** The command audit costs an afternoon against four controls and a week against four hundred. A system-write dependency discovered at Stage 6 has to be unpicked from everything built on top of it. Measuring on the reference machine from the first commit is what makes every later number comparable; starting later means the trend begins in the middle.

### 1.2 🎨 Core UX — 22

The visible loop. This is what makes the build dogfoodable rather than merely running.

| Area | Criteria |
| --- | --- |
| First run | `AC-FRE-1.1` `1.2` `1.3` `1.4` · `AC-FRE-6.1` `6.2` `6.4` |
| Widgets | `AC-WGT-2.1` `4.2` `4.4` `4.5` `6.1` `8.3` `9.1` `9.4` |
| Theme | `AC-THM-3.1` `3.2` `4.2` |
| Layout placement | `AC-LAY-2.1` `2.2` |
| Keyboard | `AC-KBD-2.2` |
| Persistence UX | `AC-DAT-4.5` |

### 1.3 🔒 Security — 4

Small, absolute, and structurally impossible to add later.

| Criterion | What it requires |
| --- | --- |
| `AC-SEC-7.1` | Writes confined to DevDesk's own locations plus autostart |
| `AC-SEC-7.2` | No injection into, hooking of, or modification of any other process |
| `AC-SEC-7.3` | No modification of Explorer, taskbar, Start menu, or system display settings |
| `AC-OFF-2.1` | Zero outbound network requests with default settings |

### 1.4 🛡️ Reliability — 11

Data safety and recovery. The first six carry `S-3`, which has no acceptable nonzero value.

| Criterion | What it requires |
| --- | --- |
| `AC-DAT-1.1` | No supported action changes an arrangement without a user action or a visible notice |
| `AC-DAT-1.2` | Forced termination loses at most the single in-flight change |
| `AC-DAT-1.3` | Power loss never produces a partially-written or unreadable arrangement |
| `AC-DAT-4.3` | Unparseable config falls back to the previous good copy, preserving the bad one |
| `AC-LAY-1.1` | No save, apply, or commit control exists anywhere |
| `AC-LAY-1.2` | An arrangement change survives immediate forced termination |
| `AC-LAY-1.3` | An arrangement change survives immediate power loss |
| `AC-ERR-2.2` | No single widget or plugin failure makes the desktop unusable |
| `AC-ERR-4.2` | Safe Mode enterable from Settings, a command-line switch, and a launch modifier |
| `AC-ERR-4.4` | Safe Mode never modifies the user's arrangement, themes, or configuration |
| `AC-ERR-4.5` | Exiting Safe Mode restores the full configuration exactly |

---

## 2. Crate Initialization Order

Seven crates from [`ADR-0003`](../docs/adr/ADR-0003-repository-layout.md) §4.1, created in dependency order so the workspace compiles after every step.

| # | Crate | Depends on | Sprint 1 state |
| --- | --- | --- | --- |
| 1 | `devdesk-telemetry` | — | **Implemented, internal-only** (§2.1) — `tracing` subscriber, startup span taxonomy, panic hook |
| 2 | `devdesk-platform` | telemetry | **Implemented** — `PlatformBackend` trait + Windows backend; macOS/Linux return `Unsupported` with a reason |
| 3 | `devdesk-display` | platform | **Implemented** — enumeration, topology fingerprint, DPI, newtype-tagged geometry |
| 4 | `devdesk-storage` | telemetry | **Implemented** — layered config, atomic write, per-user location |
| 5 | `devdesk-core` | platform, display, storage, telemetry | **Implemented** — state kernel, layout actor, event bus |
| 6 | `devdesk-ipc` | core | **Implemented** — command registry, error envelope, contract codegen |
| 7 | `devdesk-plugin-host` | platform | **Skeleton only** — crate exists so the workspace matches `RL-4`; no plugin runtime in M0 |
| 8 | `devdesk-app` *(binary, under `apps/desktop/src-tauri`)* | core, ipc | **Implemented** — thin composition root only (`DR-7`) |

**All seven library crates are created in Sprint 1**, even the one not implemented. `ADR-0003` `RL-4` makes adding a crate an ADR amendment; creating the full set now means Sprint 1 never triggers one.

**`devdesk-platform` is written before any Windows-specific work**, not after (`PROJECT_CONTEXT.md` §12.4). It is also the only crate permitted `#[cfg(target_os)]` (`DR-6`), and `scripts/lint-cfg-usage.mjs` enforces that from Day 1.

### 2.1 `devdesk-telemetry` Is Internal Infrastructure

Telemetry is architectural infrastructure, not a capability. It is consumed by every other crate and exposed by none.

| # | Rule | Enforcement |
| --- | --- | --- |
| **T-1** | **No public API.** Nothing in `devdesk-telemetry` is re-exported through `devdesk-ipc` or reachable from a command | Contract diff gate — a telemetry type appearing in the generated contract fails CI |
| **T-2** | **No plugin access.** No capability grants access to telemetry, and no host-API method exposes it | Manifest validator — there is no capability to request |
| **T-3** | **No frontend dependency.** No `packages/*` may depend on telemetry data, directly or through a command | `dependency-cruiser` + the absence of any telemetry command |
| **T-4** | Diagnostic output reaches the user **only** through the local report (`FR-ERR-5`), never as an API | `AC-ERR-5.5` — never transmitted, and never queryable |

**Why this matters now.** A telemetry crate with a public surface becomes a permanent compatibility obligation the first time anything reads it, and the natural next step is a plugin that wants "just the frame timings." Closing it on Day 1 costs nothing; closing it after a consumer exists costs a deprecation cycle.

---

## 3. Package Initialization Order

**Ten** packages, in dependency order. This is `ADR-0003` §4.1's nine plus `@devdesk/contracts` — see §3.1, which is a **pending architectural amendment, not a settled decision**.

| # | Package | Depends on | Sprint 1 state | Published |
| --- | --- | --- | --- | --- |
| 1 | `@devdesk/shared` | — (zero runtime deps, `DR-3`) | **Implemented** — `Result`, branded IDs, type guards, utilities | **Yes** |
| 2 | `@devdesk/contracts` | shared | **Implemented** — `src/generated/` IPC types; schema homes for manifest, theme, plugin, layout | **Yes** — pending §3.1 |
| 3 | `@devdesk/theme-engine` | shared, contracts | **Implemented** — token graph, resolution, custom-property emission | No |
| 4 | `@devdesk/animation` | shared | **Minimal** — reduced-motion enforcement only | No |
| 5 | `@devdesk/effects` | theme-engine | **Minimal** — one glass primitive, cost accounting stubbed | No |
| 6 | `@devdesk/hooks` | shared, contracts | **Implemented** — core-state binding, subscription lifecycle | No |
| 7 | `@devdesk/storage` | shared, contracts | **Implemented** — typed persistence client | No |
| 8 | `@devdesk/ui` | theme-engine, effects, animation | **Minimal** — only the primitives Settings needs | No |
| 9 | `@devdesk/widget-engine` | ui, storage, hooks | **Implemented** — surface lifecycle, drag, isolation | No |
| 10 | `@devdesk/plugin-sdk` | shared, contracts (`DR-4`, pending §3.1) | **Skeleton** — package and exports map exist; contract lands in M3 | **Yes** |

Every package gets its `exports` map and `private`/`publishConfig` on creation (`OW-4`, `PK-1`, `PK-2`). Published packages are marked as such from the first commit, because publishability changes the review obligations on every later change to them.

### 3.1 `@devdesk/contracts` Requires ADR-0014

Separating stable contract types from general utilities is sound: `shared` changes as utilities accrete, and contract types must not move when it does. **But the split contradicts four ratified rules, so it is scaffolded in Sprint 1 and ratified by ADR before M3.**

| Ratified rule | Conflict |
| --- | --- |
| `SYSTEM_ARCHITECTURE.md` §6.2.2 | Assigns "**generated** IPC contract types" to `@devdesk/shared` |
| `GEN-1` | Names `packages/shared/src/generated/**` as the codegen target — the path moves |
| `DR-4` | `@devdesk/plugin-sdk` **MUST depend only on** `@devdesk/shared`. The SDK re-exports the allowed contract subset, so it now needs `contracts` too |
| `ADR-0003` `PK-1` / `LR-8` | Exactly two published packages. `shared` is published **by derivation** from `DR-4`; `contracts` becomes a third by the same derivation |

**`DR-4` is the load-bearing conflict.** It exists so that a plugin's entire dependency on DevDesk is one versioned surface. Splitting contracts out makes it two, which is defensible — arguably better, since the SDK then depends on the *stable* half — but it is an amendment to a ratified boundary, not a package layout preference.

**Required before M3:** `ADR-0014` amending §6.2.2, `GEN-1`, `DR-4`, and `ADR-0003` §4.1 / `PK-1`. Sprint 1 creates the package and the codegen target; **no plugin-facing code depends on the outcome**, so scaffolding now costs nothing if the ADR narrows the split.

---

## 4. File Creation Order

Executes `ADR-0003` §10.3 `A-1`…`A-12`. Order matters: each step's tooling depends on the previous step's structure existing.

| Step | Creates | ADR-0003 |
| --- | --- | --- |
| 1 | Root `Cargo.toml` (workspace, `[workspace.dependencies]`, `[workspace.lints]`), `rust-toolchain.toml`, `.nvmrc` | `A-1`, `RL-6` |
| 2 | `pnpm-workspace.yaml`, root `package.json` (scripts only, not publishable) | `A-2`, `RL-7` |
| 3 | `crates/` — seven crate skeletons, each with `README.md` | `A-3`, `A-10` |
| 4 | `packages/` — ten packages with `package.json`, `tsconfig.json`, `src/index.ts`, `README.md` (§3, §3.1) | `A-9`, `A-10` |
| 5 | `apps/desktop/` — `src/` shell and `src-tauri/` binary crate with `capabilities/` | `A-4` |
| 6 | Retire `widgets/` and `docs/research/` | `A-5` |
| 7 | `configs/` — retire `prettier/` and `editor/`; add `dependency-cruiser/`, `stylelint/`, `typescript/` | `A-6` |
| 8 | `.github/CODEOWNERS` from the §5.1 ownership map, including security-owned paths and the no-human-owner rule for `packages/shared/src/generated/` | `A-7` |
| 9 | `tests/` — `contract/`, `platform/`, `integration/`, `e2e/`, `perf/`, `security/`; `tests/perf/README.md` linking to ADR-0002 §6.1 | `A-8`, `RL-14` |
| 10 | `dependency-cruiser` configuration implementing `DR-1`…`DR-5`, asserting non-empty match sets per rule | `A-11` |
| 11 | Wave 1 amendment pass — the ten items in `PROJECT_CONTEXT.md` §31.2, plus `ADR-0003` §10.2 and `PRD.md` Appendix D | `A-12` |

**Step 10's non-empty assertion is not optional.** A path-based lint rule that matches nothing passes silently, which is `ADR-0003` `R-7` — the rule must fail when it stops applying.

---

## 5. Daily Plan and Commit Sequence

Every commit leaves the repository green: `cargo clippy -- -D warnings`, `tsc --noEmit`, `dependency-cruiser`, and the contract diff gate all pass. **A commit that requires the next commit to build is not a commit.**

### Day 1 — Workspace, Tauri, Rust, Contracts

| # | Commit | Delivers |
| --- | --- | --- |
| 1 | `chore: add cargo workspace, pinned toolchain, and workspace lint policy` | File step 1 |
| 2 | `chore: add pnpm workspace and root scripts` | File step 2 |
| 3 | `chore: scaffold seven rust crates with boundary readmes` | File step 3 |
| 4 | `chore: scaffold ten typescript packages with exports maps` | File step 4 · §3.1 |
| 5 | `chore: add apps/desktop with tauri binary crate and capability files` | File step 5 |
| 6 | `chore: retire widgets/ and docs/research/ per ADR-0003` | File step 6 |
| 7 | `chore: restructure configs; add dependency-cruiser, stylelint, typescript` | File step 7 |
| 8 | `chore: populate CODEOWNERS from the ADR-0003 ownership map` | File step 8 |
| 9 | `chore: add cross-cutting test suites and perf readme` | File step 9 |
| 10 | `feat(ipc): command registry, error envelope, and generated contract` | Stage 1 |
| 11 | `ci: lint, typecheck, dependency layering, contract diff, cfg-usage` | File step 10 · `AC-KBD-1.2` |

**Day 1 exit:** the workspace builds, CI is green, and the generated contract exists. Nothing is user-visible, and that is correct — `IG-3` requires the contract before any feature consumes it.

### Day 2 — Theme Engine

| # | Commit | Delivers |
| --- | --- | --- |
| 12 | `feat(theme-engine): token graph, total resolution, cycle detection` | — |
| 13 | `feat(theme-engine): custom-property emission and accessibility overrides` | `AC-THM-3.1` |
| 14 | `feat(themes): bundled default dark and light themes` | `AC-FRE-3.1` basis |
| 15 | `feat(shell): apply a theme in place with no reload or remount` | `AC-THM-3.1` `3.2` |
| 16 | `feat(shell): restore the default theme in one action` | `AC-THM-4.2` |

**Theme precedes the widget runtime deliberately** (`PRD.md` Appendix C §D.2): a surface built before tokens exist hardcodes values, and third-party parity then requires a rewrite rather than a restyle.

### Day 3 — Window and Display

| # | Commit | Delivers |
| --- | --- | --- |
| 17 | `feat(platform): PlatformBackend trait with windows backend and Support reporting` | — |
| 18 | `feat(display): monitor enumeration, topology fingerprint, per-monitor dpi` | `AC-FRE-1.3` basis |
| 19 | `feat(display): newtype-tagged physical and logical geometry` | `AC-FRE-6.4` basis |
| 20 | `feat(app): create surface windows hidden and show on first frame` | `AC-FRE-1.1` |

**`AC-FRE-1.3` and `AC-FRE-6.4` are verified at 100%, 150%, and 200% on Day 3**, not at the end. Scale defects found on Day 7 are found in every layer at once.

### Day 4 — Widget Runtime

| # | Commit | Delivers |
| --- | --- | --- |
| 21 | `feat(widget-engine): surface lifecycle and per-surface isolation` | `AC-FRE-1.2` |
| 22 | `feat(widget-engine): surface rendering into a hosted window` | — |
| 23 | `feat(widget-engine): native drag path with escape-to-cancel` | `AC-WGT-4.2` `4.5` |
| 24 | `feat(surfaces): clock and system-monitor, zero capabilities` | `AC-FRE-6.1` · `AC-WGT-8.3` |
| 25 | `feat(widget-engine): add a widget fully within monitor bounds` | `AC-WGT-2.1` |

**Both surfaces load through the same path a third-party bundle will use**, even though the plugin runtime is a skeleton. If they are wired directly into the shell now, the privileged path `S-10` forbids is created on Day 4 and discovered in M3.

**Resize moved to Day 5.** Lifecycle, rendering, drag, and isolation are one integration problem — a surface that exists, paints, and moves. Resize is a second one that touches layout constraints and content reflow, and stacking it on the same day makes a failure on either indistinguishable from a failure on the other.

### Day 5 — Resize, Layout, and Persistence

| # | Commit | Delivers |
| --- | --- | --- |
| 26 | `feat(widget-engine): resize within plugin-declared bounds` | `AC-WGT-6.1` |
| 27 | `feat(storage): layered config, atomic write, per-user location` | `AC-DAT-3.1` `3.2` `1.3` |
| 28 | `feat(storage): fall back to the previous good copy on parse failure` | `AC-DAT-4.3` |
| 29 | `feat(core): layout actor with anchored placement as the default` | `AC-LAY-2.1` `2.2` |
| 30 | `feat(core): persist arrangement changes automatically, with no save action` | `AC-LAY-1.1` `1.2` · `AC-WGT-4.4` |
| 31 | `feat(widget-engine): remove a widget with session-scoped undo` | `AC-WGT-9.1` `9.4` |
| 32 | `test: forced termination and power-loss persistence suite` | `AC-LAY-1.3` · `AC-DAT-1.1` `1.2` |

**Commit 31 is not optional and does not move.** `AC-DAT-1.1` carries `S-3`, the one metric with no acceptable nonzero value, and it is verified by inducing the failure rather than by reasoning about the design.

### Day 6 — Settings and Recovery

| # | Commit | Delivers |
| --- | --- | --- |
| 33 | `feat(shell): settings shell with full keyboard navigation and visible focus` | `AC-KBD-2.2` |
| 34 | `feat(shell): command registry surface with names and descriptions` | `AC-KBD-1.1` |
| 35 | `ci: fail merge on any interactive control without a command` | `AC-KBD-1.4` |
| 36 | `feat(app): safe mode via settings, cli switch, and launch modifier` | `AC-ERR-4.2` |
| 37 | `feat(app): safe mode preserves configuration; exit restores it exactly` | `AC-ERR-4.4` `4.5` |
| 38 | `feat(shell): contain surface failure to its own bounds` | `AC-ERR-2.2` |

### Day 7 — Integration

| # | Commit | Delivers |
| --- | --- | --- |
| 39 | `feat(app): first-run default arrangement requesting zero capabilities` | `AC-FRE-1.4` `6.1` `6.2` |
| 40 | `test: offline install and first run with no network adapter` | `AC-OFF-1.1` `1.4` `2.1` |
| 41 | `test: system-state diff across install, use, and uninstall` | `AC-SEC-7.1` `7.2` `7.3` |
| 42 | `test(perf): reference-runner harness and first recorded measurement` | `AC-PERF-7.1` |
| 43 | `test: m0 acceptance suite covering all 45 criteria` | Sprint exit |
| 44 | `docs: apply the wave 1 amendment pass` | File step 11 |

---

## 6. If the Sprint Slips

The decision is made now, not under pressure. **Exactly eight criteria may move to Sprint 2, and no others.**

| Criterion | Why it can move | What is lost meanwhile |
| --- | --- | --- |
| `AC-ERR-4.2` `4.4` `4.5` | Safe Mode is the user's recovery path; the team dogfooding can recover by deleting a config file | Nothing for the team. Blocks any external tester |
| `AC-WGT-6.1` | Resize within declared bounds — ship with fixed-size widgets for one sprint | Widgets cannot be resized |
| `AC-WGT-8.3` | Per-instance configuration — ship with one instance per widget type | Two clocks cannot differ |
| `AC-WGT-9.1` `9.4` | Undo on removal — re-adding from the library achieves the same result more slowly | Removal is mildly annoying rather than reversible |
| `AC-THM-4.2` | Restore default theme in one action — only two themes exist in Sprint 1, so switching back is trivial | Recovery from a broken theme needs a manual switch |

**37 criteria are irreducible.** All 8 Foundation, all 4 Security, the 6 data-safety criteria in Reliability, and 19 of the 22 Core UX.

**What must not happen instead:** extending the sprint while carrying all 45, moving a Foundation or Security criterion, or shipping a Core UX criterion partially. Every one of the eight above is a *whole* criterion deferred with a record — not a criterion met approximately.

---

## 7. Definition of Done

Sprint 1 is complete when **every** item holds. Partial completion is not a shorter sprint; it is an unfinished one.

### 7.1 Criteria

- [ ] All 45 M0 criteria pass, **or** a subset of the eight in §6 is explicitly deferred with an owner and a Sprint 2 commitment recorded.
- [ ] Zero Foundation, Security, or data-safety criteria deferred.

### 7.2 Repository Health

- [ ] `cargo clippy -- -D warnings` passes with no allow attributes added.
- [ ] `tsc --noEmit` passes under the `TSG-1` compiler flags.
- [ ] `dependency-cruiser` passes, and every rule reports a non-empty match set.
- [ ] The generated contract regenerates with no diff.
- [ ] `scripts/lint-cfg-usage.mjs` reports zero `#[cfg(target_os)]` outside `devdesk-platform`.
- [ ] Every commit in §5 left the repository green.

### 7.3 Enforcement Live

- [ ] Command coverage audit runs in CI and reports 100%.
- [ ] CI fails on an interactive control with no command (verified by a deliberate failing case).
- [ ] `CODEOWNERS` protects `configs/` and `capabilities/`, verified by a test PR.
- [ ] The reference runner is commissioned and has produced one recorded measurement in `knowledge/performance/`.

### 7.4 Design Debt

- [ ] No merged change required global mutable state, undocumented IPC, theme-specific logic, widget-to-widget coupling, or a plugin-specific exception (`PROJECT_CONTEXT.md` §22).
- [ ] Every merged change answers "because of the contract" to §22.4.

### 7.5 The Dogfood Test

- [ ] **The team runs the build as their actual desktop for one full working day**, across at least one dock or undock cycle, without reaching for a text editor to fix anything.

This last item is the real exit condition. The rest is evidence for it.

### 7.6 Record

- [ ] `.ai/SESSION.md` updated for every agent-assisted change.
- [ ] The Wave 1 amendment pass is merged.
- [ ] Any deferred criterion is recorded with an owner, not simply absent.

---

## 8. Not in Sprint 1

Excluded so that Day 4 does not quietly become Day 9. Each is scheduled elsewhere and needs no discussion here.

| Excluded | Where it lives |
| --- | --- |
| Plugin runtime, sandbox, capability gate, grant prompts | M3 |
| Public Plugin SDK contract | M3 |
| Weather, Media, Notes surfaces | M3 — each needs a capability class that does not exist yet |
| Multi-monitor layouts, topology-bound arrangements, hotplug | M1 |
| Workspaces | M1 |
| Snapping, z-order, duplicate, lock, hide | M1 |
| Effects budget accounting and automatic degradation | M2 |
| Theme sideloading and validation | M2 |
| Widget navigation mode, global shortcuts, rebinding | M3 |
| Accessibility conformance testing, security suites, budget gating | M4 |
| Command palette | Blocked on `Q-2` (ADR) |
| Wallpaper layer | Blocked on `Q-1` (ADR) |

**A Sprint 1 pull request touching anything in this table is rejected on that basis alone**, regardless of quality. The exclusions are the sprint.

---

## Related Documents

| Document | Relationship |
| --- | --- |
| [`MVP_ACCEPTANCE_MATRIX.md`](../docs/product/MVP_ACCEPTANCE_MATRIX.md) §7.2 | Owns M0 membership. This document sequences it |
| [`PRD.md`](../docs/product/PRD.md) | Owns every criterion. Frozen at `1.1.0` — no feature enters Sprint 1 without a PRD amendment or an ADR |
| [`PRD.md`](../docs/product/PRD.md) Appendix C | Owns the dependency graph the daily order follows |
| [`ADR-0003`](../docs/adr/ADR-0003-repository-layout.md) §10.3 | Owns the file creation steps in §4 |
| [`ADR-0002`](../docs/adr/ADR-0002-performance-budgets.md) §6.1 | Owns the reference machine `AC-PERF-7.1` measures on |
| [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) 🔒 §22 | Owns the design debt policy in §7.4 |
| `SYSTEM_ARCHITECTURE.md` §25.1, §25.4 | Owns the stages and the per-change Definition of Done |

---

**45 criteria. 44 commits. 7 days. The exit condition is that you want to keep using it on day 8.**
