# ADR-0002 — Performance Budgets and Measurement Methodology

> **Abstraction Level:** 📙 **Level 2 — Architecture** (per [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md))
> **Source of Truth:** `docs/` — Specifications (*what the system should do*)

---

## Document Control

| Field | Value |
| --- | --- |
| **ADR ID** | `ADR-0002` |
| **Title** | Performance budgets and measurement methodology |
| **Status** | `ACCEPTED` |
| **Decision Date** | 2026-08-07 |
| **Effective** | On merge to `main` |
| **Deciders** | Lead Software Architect (owner), Core Engineering, Infrastructure (reference runner) |
| **Amends** | [`ADR-0001`](./ADR-0001-system-architecture.md) §3.3 delegation — supersedes `SYSTEM_ARCHITECTURE.md` §3.3 as the authoritative budget register |
| **Resolves** | ADR-0001 X-1, X-2; `SYSTEM_ARCHITECTURE.md` Appendix D OQ-6, OQ-7 |
| **Wave** | 0 — Foundation |
| **Reversal Cost** | **Low per threshold, high per methodology.** A threshold is one amendment PR. Changing the reference profile, the metric definitions, or the workload definitions invalidates every recorded trend and every prior measurement in `knowledge/performance/`. |

### Normative Language

RFC 2119 keywords carry the meanings defined in `SYSTEM_ARCHITECTURE.md` §1.1.

### Ownership Boundary

This ADR owns **numeric thresholds, workloads, metrics, and measurement method**.

It does **not** own the architectural rules that make those numbers reachable. `SYSTEM_ARCHITECTURE.md` §17 (PF-1…PF-16), §8 (scoped subscriptions), §11.4 (plugin lifecycle), and §14 (startup sequence) remain authoritative for *design*; this document is authoritative for *how much* and *how measured*. Where an implementation satisfies a number by violating a PF rule, the number is satisfied and the PR is still rejected.

The effect **degradation mechanism** (TH-7, DD-010) is owned by `ADR-0011`. This ADR sets the budget the mechanism defends.

---

## 1. Context

### 1.1 Why This ADR Exists

[`ADR-0001`](./ADR-0001-system-architecture.md) ratified the DevDesk system architecture but explicitly withheld ratification of `SYSTEM_ARCHITECTURE.md` §3.3, its budget table, and delegated it here (ADR-0001 RA-4, D-7). Two independent problems forced that delegation.

**First, the repository contains contradictory performance statements.** [`.ai/CLAUDE.md`](../../.ai/CLAUDE.md) states a four-line target set — `Startup < 2 seconds`, `Idle RAM < 100 MB`, `Idle CPU < 1%`, `60 FPS animations` — that predates the architecture. `SYSTEM_ARCHITECTURE.md` §3.3 states twelve budgets (B-1…B-12) with different numbers, different units, and different implied workloads. Neither document is marked subordinate to the other, so a reviewer rejecting a PR on memory grounds has two citable and incompatible authorities. Section 3 of this ADR resolves all twelve conflicts individually.

**Second, §3.3 is not measurable as written.** Its own interpretation rule states that budgets are measured on *"the reference machine profile defined in `tests/perf/README.md`"* — a file that does not exist. Appendix D OQ-7 lists that profile as an open question due *"before Stage 1 exit."* Meanwhile nine of the twelve budgets are marked **Blocking**. A blocking CI gate whose measurement basis is undefined is not a gate: its first invocation is waived, and a waived gate is never re-armed. `SYSTEM_ARCHITECTURE.md` PF-3 states the principle exactly — *budgets are gates, not goals; an unenforced target is a preference*.

### 1.2 What Exists to Measure

Nothing. The repository contains no source code, no `Cargo.toml`, no `package.json`, and no `tests/` content. Every number in this document is therefore an **engineering estimate, not a measurement**, and the document's most important structural feature is that it says so explicitly for every value (§11, §12).

This is not a reason to defer. Budgets authored after the code exists are reverse-engineered from whatever the code happens to do, which is how performance requirements become tautologies. Budgets authored first are falsifiable — and §12 names the spike that will falsify each one.

### 1.3 What the Architecture Already Fixes

Three architectural properties constrain the budget space and are assumed throughout:

- **Idle cost is eliminated, not tuned** (PF-4, PF-5, PF-6, ST-7, ST-10). Idle budgets are therefore near-zero rather than merely small, and a nonzero idle cost is a design defect rather than a tuning opportunity.
- **The webview main thread is the scarce resource** (PF-1). Rendering and interaction budgets are stated against it; host-process budgets are comparatively generous because host work does not block a frame.
- **Continuous gestures bypass IPC entirely** (PF-8, ST-12, ST-13). Interaction budgets assume the native window layer moves the window, so they are not IPC-latency-bound.

---

## 2. Problem Statement

**DevDesk declares performance a feature and enforces it with CI gates, but has no definition of the machine, the workload, the metric, or the statistic against which any number is checked — and the numbers it does have contradict each other.**

Five specific defects:

1. **Contradictory magnitudes.** `Idle RAM < 100 MB` versus `≤ 320 MB total across all processes` differ by 3.2×. No document explains whether they measure the same thing, the same workload, or the same processes.
2. **Undefined units.** `Idle CPU < 1%` has no denominator. On a 16-thread machine, 1% of total CPU is 16% of one core — a 16× ambiguity in a *blocking* gate.
3. **Undefined workload.** B-3 and B-4 name "12 surfaces, 3 monitors." B-1, B-2, B-5, B-7, B-8, and B-12 name nothing. A cold-start budget measured with one surface and a cold-start budget measured with twelve are different budgets.
4. **Undefined measurement basis.** The reference profile is deferred to a nonexistent file (OQ-7), while QA-3 independently names *"a mid-range 2020 laptop, SSD, 16 GB RAM"* — a second, informal definition of the same thing.
5. **Internal incoherence.** B-12 requires process exit within 400 ms; LC-7 grants plugins a 1500 ms shutdown grace; PL-5 sets the teardown hard timeout at 2000 ms. All three cannot hold.

Until these are resolved, `SYSTEM_ARCHITECTURE.md` §25.4's Definition of Done item *"Budgets in §3.3 unaffected"* cannot be evaluated by any reviewer.

---

## 3. Contradiction Resolutions

Every conflict identified in ADR-0001 X-1 and X-2 is resolved below. Each resolution states which source survives, in what form, and why.

| # | Contradiction | Resolution | Reasoning |
| --- | --- | --- | --- |
| **CR-1** | `Startup < 2 seconds` (`.ai/CLAUDE.md`) vs `B-1 ≤ 800 ms first paint` / `B-2 ≤ 1200 ms interactive` | Both survive as **different checkpoints of one sequence**: `PB-S1` first paint, `PB-S2` interactive, `PB-S3` fully hydrated ≤ 2000 ms p50. The legacy "< 2 s" is `PB-S3` p50. | The statements were never in conflict on substance — they name different moments in §14.1's startup sequence. The defect was that neither said which moment. Naming three observable checkpoints (§7.1) preserves the user-perceptible "< 2 s ready" intuition while keeping the aggressive first-paint target that LC-1/LC-3 make achievable. |
| **CR-2** | `Idle RAM < 100 MB` vs `B-4 ≤ 320 MB total across all processes` | `< 100 MB` is **retired as a system budget** and replaced by `PB-M1` (host process ≤ 80 MB at W2, ≤ 45 MB at W0). `PB-M3` retains ≤ 320 MB as the W2 process-tree total; `PB-M4` sets ≤ 150 MB for W0. | The two figures measure different things. A multi-webview architecture (C-1) carries an irreducible WebView2/WKWebView/WebKitGTK process-group floor; no configuration with 12 surfaces reaches 100 MB, and publishing an unreachable budget teaches the team to ignore budgets. The ≤ 100 MB intuition is defensible for the **Rust host process alone**, which is what `PB-M1` now states. §8 additionally fixes the *metric* (private working set), which is the second reason the numbers appeared incompatible. |
| **CR-3** | `Idle CPU < 1%` (no denominator) vs `B-3 ≤ 1.0% of one core (60 s mean)` | `B-3`'s definition survives verbatim; §8.3 defines **core-percent** as the unit for every CPU budget. `PB-C1 ≤ 1.0 core-%`. | Not a substantive conflict — a missing unit. Fixing the unit makes the legacy statement measurable rather than changing it. |
| **CR-4** | `60 FPS animations` vs `QA-2 ≥ 120 fps` vs `B-8 ≤ 16.6 ms / ≤ 8.3 ms` | `PB-R1`: the frame budget is **refresh-relative** — `min(refresh_interval, 16.6 ms)` at p99 — with 16.6 ms as an absolute floor regardless of refresh rate. | 60 FPS is a **floor, not a target**. A fixed 60 FPS budget on a 144 Hz monitor permits dropping every second frame while passing; a fixed 8.3 ms budget fails a 60 Hz monitor that is behaving perfectly. Refresh-relative is the only formulation that is correct on both. |
| **CR-5** | `B-12 shutdown ≤ 400 ms` vs `LC-7 shutdown grace 1500 ms` | Split into `PB-D1` **quiescent shutdown** ≤ 400 ms p95 (no plugin consumes grace) and `PB-D2` **bounded worst case** ≤ 2200 ms hard ceiling, watchdog-enforced. | Both requirements are legitimate and describe different paths. The common case — no plugin needs its grace — must be fast, because that is what the user experiences on every quit. The worst case must be *bounded*, not fast, because LC-7 exists precisely to let a plugin flush state. An unsplit budget forces one of the two to be violated on every shutdown involving a plugin. |
| **CR-6** | `LC-7 grace = 1500 ms` vs `PL-5 teardown hard timeout = 2000 ms` | Unified in `PB-P6`: **1000 ms ack window, 1500 ms hard terminate**. | Two timeouts governing the same transition is a defect regardless of their values. 1000/1500 is chosen so that `PB-D2` (2200 ms) remains reachable with 700 ms for transactional persistence (`PB-D3`) and telemetry flush. |
| **CR-7** | Nine budgets marked **Blocking** while the reference machine profile is unresolved (OQ-7) | §6 defines the reference profile `RP-1…RP-3`; §10 defines a **gate activation schedule** binding each budget's gate state to the existence of its harness and its validating spike. **OQ-7 is resolved.** | A gate is a function of three things: a threshold, a harness, and a stable measurement environment. Declaring the first without the other two produces waivers. The schedule makes gate state derivable rather than asserted. |
| **CR-8** | `B-9 plugin activation = Warn` while `AP-12`/`PL-11`/`LC-1` charge activation directly against the Blocking `B-1` | `PB-P1` (activation latency) is **Warn until Stage 7, Blocking from Stage 7**. `PB-P9` is added: **20 installed, non-activated plugins MUST contribute 0 ms to `PB-S1`**, blocking from Stage 1 and measured with the `W3` fixture. | The architecture's actual concern in AP-12 is not how long one plugin takes to activate — it is that installed plugins must not be on the startup critical path at all (LC-1). That is a structural property, testable immediately and independently of plugin implementation quality, so it is gated early. Activation latency is a per-plugin quality metric and is gated when plugins exist. |
| **CR-9** | `QA-3` names "mid-range 2020 laptop, SSD, 16 GB RAM"; §3.3 defers to `tests/perf/README.md` | `RP-1` (§6.1) is defined to match the QA-3 hardware class exactly. `tests/perf/README.md`, when created, **MUST link to this section and MUST NOT restate it**. | Two definitions of the measurement machine is the same class of defect as a hand-written contract mirror (AP-13): they drift, and the drift is silent. One definition, one home, referenced from elsewhere. |
| **CR-10** | Most budgets state no workload | §6.2 defines four workloads `W0…W3`. **Every budget in §7 names its workload.** A budget without a workload is void. | A latency number without a workload is not falsifiable. Four fixed workloads also make regressions attributable: a budget that passes at W1 and fails at W2 localizes the defect to per-surface scaling. |
| **CR-11** | Percentiles stated inconsistently (`B-2`, `B-7`, `B-9` give one percentile; `B-1`, `B-5`, `B-8` give two; `B-3` gives a mean) | Every budget in §7 states its statistic explicitly. §8.5 fixes sample size, warm-up handling, and the validity guard. | Mixed statistics prevent comparison between budgets and make trend series incoherent. Latency budgets are stated at p50 **and** a tail percentile, because p50-only hides the jank users actually notice. |
| **CR-12** | `BP-3` coalesces continuous values to one message per display refresh (up to 144 Hz) while `TR-1` requires any source above 20 msg/s to use a Channel | No change to either rule; clarified: **refresh-aligned streams are Channels by construction**, governed by `PB-X3`, never by the event path. `PB-X5` caps the command rate so the inverse mistake (AP-1) is also gated. | The rules were consistent but the interaction was unstated, which is exactly the ambiguity AI-4 requires to be raised rather than interpreted. Stating it here removes the interpretation. |

---

## 4. Decision

**D-1.** The budget register in §7 **supersedes** `SYSTEM_ARCHITECTURE.md` §3.3. B-1…B-12 are retained as historical identifiers and mapped to their successors in §5; they MUST NOT be cited in new work.

**D-2.** The reference profile (§6.1), workloads (§6.2), metric definitions (§8), and statistical method (§8.5) are **normative**. A measurement taken outside them is informational and MUST NOT be used to pass, fail, or amend a budget.

**D-3.** Every budget carries a **validation class** (§11) and, where applicable, a **named validating spike** (§12). A budget MUST NOT hold a `block` gate state before its harness exists and, for prototype-gated budgets, before its spike has landed in `knowledge/`.

**D-4.** Gate state is determined by the **activation schedule** (§10), not by individual judgement. A stage MUST NOT be declared complete while a budget scheduled to gate at that stage is still `off` (IG-1).

**D-5.** `SYSTEM_ARCHITECTURE.md` Appendix D **OQ-7 is resolved** by §6.1 and **OQ-6 is resolved numerically** by `PB-M10` (5 MB default plugin private-state quota). OQ-6's *enforcement UX* remains open and is owned by `ADR-0012` at Stage 7.

**D-6.** Budgets **ratchet in one direction without an ADR**: a threshold may be *tightened* by an amendment PR that links the measurement justifying it. *Loosening* a threshold, changing a validation class to `Ratified`, or changing a gate state ahead of schedule requires an amendment to this ADR approved by the budget owner (§13).

---

## 5. Budget Identifier Mapping

| Legacy | Successor | Disposition |
| --- | --- | --- |
| B-1 Cold start → first paint | `PB-S1` | Retained; workload and cache state defined |
| B-2 Cold start → interactive | `PB-S2` | Retained; p95 added; "interactive" defined observably (§7.1) |
| B-3 Idle CPU | `PB-C1` | Retained; unit formalized as core-percent |
| B-4 Idle RSS | `PB-M3` | Retained as the W2 total; decomposed into `PB-M1`, `PB-M2`; metric changed to private working set (§8.2) |
| B-5 IPC round trip | `PB-X1` | Retained verbatim |
| B-6 Event fan-out | `PB-X2` | Retained verbatim |
| B-7 Theme switch | `PB-R4` | Retained; workload fixed to W2 |
| B-8 Frame budget | `PB-R1` | Reformulated as refresh-relative (CR-4) |
| B-9 Plugin cold activation | `PB-P1` | Retained; gate schedule revised (CR-8); `PB-P9` added |
| B-10 Core binary size | `PB-Z1` | Retained verbatim |
| B-11 Shell JS bundle | `PB-Z2` | Retained verbatim |
| B-12 Shutdown | `PB-D1` | Split into `PB-D1` / `PB-D2` (CR-5) |

---

## 6. Reference Profile and Workloads

### 6.1 Reference Machine Profile

**RP-1 — Hardware.** The reference machine is a mid-range 2020-class notebook, matching the QA-3 scenario:

| Component | Specification | Rationale |
| --- | --- | --- |
| CPU | 4 physical / 8 logical cores, ~2.4 GHz base (Intel Core i5-1135G7 or AMD Ryzen 5 5500U class) | The median target user's machine, not a developer workstation. Budgets tuned on a 16-core desktop are met by nobody. |
| Memory | 16 GB DDR4, dual-channel | Dual-channel is required: integrated GPUs share system memory bandwidth, and single-channel halves effective glass compositing throughput |
| Storage | NVMe SSD, ≥ 20% free | Startup budgets are IO-sensitive; a near-full drive changes `startup.storage` materially |
| GPU | Integrated (Intel Iris Xe or AMD Vega 7 class) | Glass is the platform's signature and its dominant GPU cost (DD-010). Budgeting on discrete graphics validates nothing. |
| Displays | 3 attached: **(a)** 2560×1440 @ 144 Hz, 100% scale — primary; **(b)** 1920×1080 @ 60 Hz, 100% scale; **(c)** 3840×2160 @ 60 Hz, 150% scale | Mixed DPI and mixed refresh are mandatory (TS-5, WD-2). A uniform-DPI reference cannot detect the largest defect class in this system (AP-6). |

**RP-2 — Software.**

| Component | Specification |
| --- | --- |
| OS | Windows 11 23H2 or later, primary reference (C-4) |
| Webview | WebView2 Evergreen, **version pinned per measurement run and recorded with the result** |
| Toolchain | Pinned by `rust-toolchain.toml` and `.nvmrc` (BR-4) |
| Build | Release profile with LTO, `codegen-units = 1`, `panic = "abort"`, stripped (BR-2) |
| Secondary references | macOS 14+ on Apple Silicon (8 GB class) and Ubuntu 24.04 LTS on X11 and Wayland, for `PB-*` **portability parity** only (§10.4) |

**RP-3 — Environmental controls.** All are preconditions; a run that violates any is invalid, not merely noisy.

1. AC power, "Balanced" power plan, battery saver off.
2. Thermal state verified before each run: package temperature within 5 °C of idle baseline. A run beginning while throttled is discarded.
3. No other user applications running; Windows Search indexing, Defender scheduled scans, and Windows Update paused for the run window.
4. Display configuration exactly RP-1(a,b,c); no external capture, no remote desktop session.
5. Machine dedicated to measurement — **not** a shared or cloud CI runner (§10.3).
6. WebView2 user-data directory reset between cold-start runs; preserved between warm-start runs.

**RP-4.** `tests/perf/README.md`, when authored, **MUST** link to this section as the single definition and MUST NOT restate the profile (CR-9, AP-13 by analogy).

### 6.2 Workload Profiles

Every budget names exactly one workload. Fixtures live under `tests/perf/fixtures/`.

| ID | Name | Surfaces | Monitors | Plugins | Theme | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| **W0** | Safe Mode | 1 | 1 (RP-1a) | 0 | Default, no glass | The architectural floor (LC-9). Isolates the platform's irreducible cost from DevDesk's own. |
| **W1** | Nominal | 6 | 2 (RP-1a,b) | 3 active | Default glass | The expected everyday configuration. Regressions surface here first. |
| **W2** | Reference | 12 | 3 (RP-1a,b,c) | 8 active | Full glass | The QA-1/QA-3 scenario. **The default workload**: a budget that names no workload is invalid, but the intended reading is always W2. |
| **W3** | Stress | 24 | 3 | 20 installed / 4 active | Full glass | Scaling and eager-activation detection (AP-12). Used for `PB-P9` and for marginal-cost budgets. |

**WL-1.** Surfaces in every workload are distributed across monitors as evenly as the monitor count permits, with at least one surface on the 150%-scale display.
**WL-2.** W1–W3 plugin fixtures are **synthetic reference plugins** in `tests/perf/fixtures/plugins/`, not first-party product plugins. Budget measurement MUST NOT depend on the behaviour of a shipping feature.
**WL-3.** W2 is the workload for every budget unless stated otherwise.

---

## 7. Budget Register

Columns: **Budget** — the threshold. **W** — workload. **Cls** — validation class (§11): `D` derived, `P` provisional, `G` prototype-gated. **Harness** — the file that measures it.

### 7.1 Startup Budgets

**Observable checkpoints.** These definitions are normative; a harness that measures a different moment measures a different budget.

| Checkpoint | Definition |
| --- | --- |
| `T0` | OS-reported process creation timestamp — **not** the first line of `main`. Loader and runtime init are DevDesk's cost. |
| **First surface painted** | The first frame of any surface window presented to the compositor after `show`, correlated between the shell mark `devdesk.surface.first-paint` and the host span `startup.shell` (LC-4). Windows are created hidden and shown only when their first frame is ready (LC-3), so this is also the first pixel the user sees. |
| **Interactive** | All three hold: every visible surface scope has an authoritative snapshot (§8.2); input handlers are attached; the webview main thread has been idle ≥ 50 ms since first paint. |
| **Fully hydrated** | Every plugin whose activation event was satisfied at launch has reached `Active` (§11.4) and its surface has painted real content rather than skeleton chrome. |

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-S1` | `T0` → first surface painted | ≤ 800 ms p50, ≤ 1200 ms p95 | W2 | G | `tests/perf/coldstart.bench.ts` |
| `PB-S2` | `T0` → interactive | ≤ 1200 ms p50, ≤ 1800 ms p95 | W2 | G | `tests/perf/coldstart.bench.ts` |
| `PB-S3` | `T0` → fully hydrated | ≤ 2000 ms p50, ≤ 3000 ms p95 | W2 | P | `tests/perf/coldstart.bench.ts` |
| `PB-S4` | `T0` → first paint, cold OS file cache (first launch after boot) | ≤ 2400 ms p95 | W2 | P | `tests/perf/coldstart.bench.ts` (nightly) |
| `PB-S5` | `T0` → first paint, Safe Mode | ≤ 400 ms p50, ≤ 600 ms p95 | W0 | P | `tests/perf/coldstart.bench.ts` |
| `PB-S6` | `T0` → first paint, warm restart (primed cache, existing DB) | ≤ 600 ms p95 | W2 | D | `tests/perf/coldstart.bench.ts` |
| `PB-S7` | Marginal contribution to `PB-S1` per additional surface | ≤ 30 ms | W0→W2 | D | `tests/perf/coldstart.bench.ts` |

**Derivation of `PB-S7` and `PB-S1`.** `PB-S5` (400 ms p50, one surface) + 11 × `PB-S7` (330 ms) = 730 ms ≤ `PB-S1` p50 (800 ms), leaving 70 ms of headroom. The three budgets are therefore mutually constraining: a `PB-S7` regression consumes `PB-S1` headroom before it breaches its own threshold, which is the intended early-warning behaviour.

**Phase sub-budgets (`PB-S8`).** Each is a `tracing` span required by LC-4, measured at p95 under W2. Their existence is what makes a `PB-S1` regression attributable without bisecting.

| Span | Budget | On critical path | Note |
| --- | --- | --- | --- |
| `startup.process` | ≤ 90 ms | Yes | Loader, runtime init, tracing subscriber, panic hook, crash handler |
| `startup.storage` | ≤ 80 ms | Yes | Open config + state, SQLite integrity check (LC-2) |
| `startup.display` | ≤ 50 ms | Yes | Monitor enumeration + topology fingerprint (LC-2) |
| `startup.layout` | ≤ 30 ms | Yes | Resolve placements for the fingerprint (LC-2) |
| `startup.window` | ≤ 220 ms | Yes | Create 12 hidden windows |
| `startup.shell` | ≤ 450 ms | Yes | Bundle load, parse, mount, subscribe, first paint |
| `startup.plugins` | ≤ 700 ms | **No** (LC-1) | Discover + validate + verify signatures for 8 bundles |
| `startup.hydrate` | ≤ 1400 ms | **No** | Activation → real content painted; bounded by `PB-S3` |

Critical-path sum: 920 ms ≤ `PB-S1` p95 (1200 ms), with 280 ms reserve. **A phase budget MUST NOT be raised by consuming another phase's reserve without an amendment PR** — the reserve absorbs measurement variance, not design overruns.

### 7.2 Memory Budgets

**Metric.** Private working set summed across the DevDesk process tree (§8.2). Shared pages are reported separately and are **not** charged. Measured after 60 s of enforced idle at the stated workload.

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-M1` | Host process (`devdesk-app`) private WS | ≤ 80 MB (W2) · ≤ 45 MB (W0) | W2/W0 | P | `tests/perf/idle.bench.rs` |
| `PB-M2` | Webview process group private WS, **including plugin workers** | ≤ 232 MB (W2) · ≤ 105 MB (W0) | W2/W0 | G | `tests/perf/idle.bench.rs` |
| `PB-M3` | **Total** private WS, whole process tree | ≤ 320 MB | W2 | D | `tests/perf/idle.bench.rs` |
| `PB-M4` | **Total** private WS, Safe Mode | ≤ 150 MB | W0 | D | `tests/perf/idle.bench.rs` |
| `PB-M5` | Marginal private WS per additional surface | ≤ 12 MB | W0→W2 | G | `tests/perf/idle.bench.rs` |
| `PB-M6` | Marginal private WS per `Active` plugin worker | ≤ 4 MB | W2 | G | `tests/perf/plugin.bench.rs` |
| `PB-M7` | 24 h soak growth versus the 1 h baseline | ≤ 5% | W2 | P | `tests/perf/soak.bench.rs` (weekly) |
| `PB-M8` | Transient peak during theme switch or topology change | ≤ 400 MB (1.25 × `PB-M3`) | W2 | P | `tests/perf/theme.bench.ts` |
| `PB-M9` | Disposable cache resident in RAM (SQLite page cache + resolved token graphs) | ≤ 24 MB | W2 | P | `tests/perf/idle.bench.rs` |
| `PB-M10` | Plugin private state, on disk | 5 MB per plugin (PR-8 default) · ≤ 100 MB total | — | P | `tests/integration/storage_quota.rs` |

**Derivation.** `PB-M3` = `PB-M1`(80) + `PB-M2`(232) = 312 MB, with an 8 MB reserve to 320. `PB-M4` = 45 + 105 = 150 MB. `PB-M5` is the implied slope: (80−45 + 232−105 − 8 workers × `PB-M6`) ÷ 11 surfaces = (35 + 127 − 32) ÷ 11 ≈ 11.8 MB, stated as ≤ 12 MB. **The four budgets are one model, not four independent numbers** — `PB-M2`, `PB-M5`, and `PB-M6` are the measured quantities; `PB-M3` and `PB-M4` are their sums. If the prototype invalidates `PB-M5`, `PB-M3` fails arithmetically and both are amended together.

**`PB-M7` is the anti-pattern gate.** AP-11 (unbounded event fan-out) presents to users as a leak; it is actually queue growth. The soak harness asserts both the RSS ceiling and, independently, that every subscription queue depth returns to baseline (BP-1, CM-2).

### 7.3 CPU Budgets

**Unit — core-percent.** `100 core-% = one logical core fully saturated`. Computed as `Σ(kernel + user CPU time deltas across the process tree) ÷ wall-clock elapsed × 100`. On RP-1 (8 logical cores), full machine saturation is 800 core-%. This unit resolves CR-3 and is used by every CPU budget without exception.

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-C1` | Idle, 60 s mean, aggregate | ≤ 1.0 core-% | W2 | D | `tests/perf/idle.bench.rs` |
| `PB-C2` | Idle, 60 s mean, Safe Mode | ≤ 0.3 core-% | W0 | P | `tests/perf/idle.bench.rs` |
| `PB-C3` | Marginal idle cost per surface | ≤ 0.04 core-% | W0→W2 | P | `tests/perf/idle.bench.rs` |
| `PB-C4` | Marginal idle cost per `Active` plugin worker | ≤ 0.02 core-% | W2 | P | `tests/perf/plugin.bench.rs` |
| `PB-C5` | Host process timer wakeups at idle | ≤ 2 /s | W2 | D | `tests/perf/idle.bench.rs` |
| `PB-C6` | `Suspended` plugin worker | 0 wakeups, 0.00 core-% | W2 | D | `tests/perf/plugin.bench.rs` |
| `PB-C7` | Sustained drag gesture, aggregate | ≤ 25 core-% · host process ≤ 5 core-% | W2 | G | `tests/perf/interaction.bench.ts` |
| `PB-C8` | Theme switch peak | ≤ 80 core-% for ≤ 150 ms | W2 | P | `tests/perf/theme.bench.ts` |
| `PB-C9` | Idle on battery / low-power (Reduced tier, PF-7) | ≤ 0.5 core-% | W2 | P | `tests/perf/idle.bench.rs` (nightly) |
| `PB-C10` | Plugin CPU watchdog thresholds (T-11) | Reduced tier at > 15 core-% sustained 5 s · terminate + quarantine at > 40 core-% sustained 10 s | — | P | `tests/security/plugin_dos.rs` |

**Derivation of `PB-C1`.** `PB-C2`(0.3) + 11 × `PB-C3`(0.44) + 8 × `PB-C4`(0.16) = 0.90 core-%, with 0.10 reserve to 1.0. As with memory, the aggregate is a sum of measured slopes rather than an independent target.

**`PB-C5` is the structural enforcement of LC-5 and PF-5.** Two wakeups per second is one core state timer plus one coalesced scheduler tick. Twelve plugins with 1 Hz timers MUST still produce one wakeup per second; a wakeup count that scales with surface or plugin count is a supervisor defect, not a tuning problem.

### 7.4 Rendering Budgets

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-R1` | Interaction frame budget, p99 on the surface main thread | `min(refresh_interval, 16.6 ms)` — 16.6 ms @ 60 Hz, 8.3 ms @ 120 Hz, 6.9 ms @ 144 Hz. Never worse than 16.6 ms at any refresh rate. | W2 | G | `tests/perf/interaction.bench.ts` |
| `PB-R2` | Dropped frames during a 3 s drag | ≤ 1.0% of expected frames; **zero** runs of ≥ 2 consecutive drops | W2 | G | `tests/perf/interaction.bench.ts` |
| `PB-R3` | Repaints over 60 s idle (QA-1) | **exactly 0** on every surface | W2 | D | `tests/perf/idle.bench.ts` |
| `PB-R4` | Theme switch → last surface painted | ≤ 120 ms p95 | W2 | P | `tests/perf/theme.bench.ts` |
| `PB-R5` | Live glass (`backdrop-filter`) composited layers | ≤ 6 per monitor (PF-11); ≤ 8 total promoted compositor layers per surface | W2 | P | `tests/perf/effects.bench.ts` |
| `PB-R6` | Surface show (hidden → first frame) | ≤ 100 ms p95 | W2 | P | `tests/perf/surface.bench.ts` |
| `PB-R7` | Main-thread long tasks | Steady state: **0** tasks > 50 ms. Startup: ≤ 1 task > 50 ms, none > 120 ms. | W2 | P | `tests/perf/interaction.bench.ts` |
| `PB-R8` | Style + layout recalculation per applied state delta | ≤ 2.0 ms p95 on the receiving surface | W2 | P | `tests/perf/surface.bench.ts` |
| `PB-R9` | GPU memory | ≤ 220 MB | W2 | G | `tests/perf/effects.bench.ts` (report only — §10.4) |

**`PB-R1` is measured at the target monitor's refresh rate, per surface.** A surface on the 60 Hz display and a surface on the 144 Hz display are evaluated against different thresholds in the same run. This is the direct implementation of CR-4 and is why RP-1 mandates mixed refresh.

**`PB-R3` is a zero, not a small number.** A single idle repaint means a subscription is producing state nobody rendered (ST-10) or an animation did not stop. Both are defects with unbounded cost over a day of uptime, so the budget admits no tolerance.

**`PB-R5` is the input to `ADR-0011`.** This ADR fixes the layer cap; the degradation *order* when the cap is exceeded (TH-7) is owned by ADR-0011.

### 7.5 IPC and Transport Budgets

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-X1` | Command round trip, payload ≤ 4 KB | ≤ 1.5 ms p50, ≤ 4.0 ms p99 | W2 | G | `tests/perf/ipc.bench.rs` |
| `PB-X2` | Event fan-out, core → 12 surfaces | ≤ 3.0 ms p99 wall clock | W2 | G | `tests/perf/ipc.bench.rs` |
| `PB-X3` | Channel message ≤ 1 KB, core → one surface | ≤ 0.4 ms p50, ≤ 1.2 ms p99 | W2 | G | `tests/perf/ipc.bench.rs` |
| `PB-X4` | Raw response (`ipc::Response`), 1 MB payload | ≤ 12 ms p95 | W2 | P | `tests/perf/ipc.bench.rs` |
| `PB-X5` | Steady-state command rate | ≤ 2 commands/s per surface; ≤ 30 commands/s aggregate | W2 | D | `tests/perf/idle.bench.ts` |
| `PB-X6` | Event drops at nominal load | **0**; every drop increments `devdesk_ipc_event_dropped_total` (BP-4) | W2 | D | `tests/perf/ipc.bench.rs` |
| `PB-X7` | Subscription queue depth | Default 64 (BP-1); configured maximum 256 | — | P | `tests/integration/bus.rs` |

**`PB-X5` is the machine-checkable form of TR-3 and AP-1.** The lint (`scripts/lint-ipc-hotpath.mjs`) catches the syntactic cases — `invoke` inside `setInterval`, `requestAnimationFrame`, or a dependency-free `useEffect`. `PB-X5` catches the rest, including polling reached indirectly through a helper the lint cannot see.

**`PB-X4` derivation.** 1 MB via `ipc::Response` avoids the JSON + base64 path (TR-2), which on the same payload costs roughly an order of magnitude more. The budget exists so that TR-2's benefit is measured rather than assumed; if the measured gap is small, TR-2's 64 KB threshold is the thing to re-examine.

### 7.6 Plugin Budgets

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-P1` | Cold activation, `Granted` → `Active` | ≤ 250 ms p95 | W2 | P | `tests/perf/plugin.bench.rs` |
| `PB-P2` | Manifest parse + schema validate + signature verify, per bundle | ≤ 40 ms p95 | W2 | P | `tests/perf/plugin.bench.rs` |
| `PB-P3` | Host call round trip: worker → broker → capability gate → core → worker, ≤ 4 KB | ≤ 3.0 ms p95 | W2 | G | `tests/perf/plugin.bench.rs` |
| `PB-P4` | Capability gate decision (§18.4 steps 1–5), excluding execution | ≤ 0.3 ms p95 | W2 | P | `tests/perf/plugin.bench.rs` |
| `PB-P5` | Suspend: `Active` → `Suspended`, timers and subscriptions released (PL-6) | ≤ 50 ms p95 | W2 | P | `tests/perf/plugin.bench.rs` |
| `PB-P6` | Teardown: ack window / hard terminate | 1000 ms / 1500 ms (CR-6) | — | D | `tests/integration/plugin_lifecycle.rs` |
| `PB-P7` | Idle `Active` worker cost | ≤ 4 MB private WS (`PB-M6`), ≤ 0.02 core-% (`PB-C4`) | W2 | G | `tests/perf/plugin.bench.rs` |
| `PB-P8` | Bundle size | `dist/` ≤ 2 MB; total bundle ≤ 10 MB | — | P | `scripts/size-report.mjs` |
| `PB-P9` | Startup contribution of **20 installed, non-activated** plugins to `PB-S1` | **0 ms** (LC-1) — `PB-S1` at W3 MUST equal `PB-S1` at W2 within measurement variance | W3 | D | `tests/perf/coldstart.bench.ts` |
| `PB-P10` | Private state quota | 5 MB per plugin (= `PB-M10`; resolves OQ-6 numerically) | — | P | `tests/integration/storage_quota.rs` |

**`PB-P3` derivation.** `PB-X1` p50 (1.5 ms) plus the structured-clone broker hop, the five capability-gate checks (`PB-P4`, 0.3 ms), and the return path. 3.0 ms p95 is the sum with realistic tail allowance. It is deliberately **not** equal to `PB-X1`: a plugin call is architecturally more expensive than a first-party command, and pretending otherwise would create pressure to shortcut the gate — which is AP-IV's failure mode.

**`PB-P9` is the load-bearing plugin budget.** It converts AP-12 and LC-1 from a review-time judgement into a measurement: if installing plugins costs startup time, the architecture's central startup claim is false regardless of how fast any individual plugin activates. It is stated as an equality against the W2 measurement rather than an absolute, because it tests a *structural* property.

### 7.7 Surface (Widget Runtime) Budgets

*"Surface" is the internal term; "widget" is user-facing vocabulary only (§12).*

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-G1` | Surface create → first paint | ≤ 100 ms p95 (= `PB-R6`) | W2 | P | `tests/perf/surface.bench.ts` |
| `PB-G2` | Layout solve, 24 surfaces across 3 monitors (pure, synchronous, Rust) | ≤ 4.0 ms p95; **byte-identical output across 1000 runs** (WR-3) | W3 | P | `tests/perf/layout.bench.rs` |
| `PB-G3` | Drag start latency: pointer down → window follows | ≤ 2 frames at the target refresh | W2 | G | `tests/perf/interaction.bench.ts` |
| `PB-G4` | Resize reflow, per resize step | ≤ 1 frame budget (`PB-R1`) | W2 | G | `tests/perf/interaction.bench.ts` |
| `PB-G5` | Gesture commit: gesture end → `Confirmed` (§8.4, ST-12) | ≤ 50 ms p95 | W2 | P | `tests/perf/interaction.bench.ts` |
| `PB-G6` | Per-surface footprint | ≤ 1500 DOM nodes; ≤ 4 MB JS heap p95 | W2 | G | `tests/perf/surface.bench.ts` |
| `PB-G7` | Topology change → layout reapplied, all surfaces repainted (after the 250 ms WD-6 debounce) | ≤ 400 ms p95 | W2 | P | `tests/perf/topology.bench.rs` |
| `PB-G8` | Error placeholder rendered after a surface render failure (WR-5) | ≤ 150 ms p95 | W2 | P | `tests/perf/surface.bench.ts` |

**`PB-G6` constrains `PB-M5`.** A 4 MB JS heap plus document, style, and compositor allocations must fit inside the ~8.6 MB webview share of the 12 MB marginal surface cost. Raising `PB-G6` without raising `PB-M5` is arithmetically impossible, and the harness asserts both.

**`PB-G2`'s determinism clause is not a performance property** but is measured by the same harness because the same fixture produces both. Non-deterministic layout presents to users as surfaces that "wander" between sessions, which is a correctness defect that only a repeated-run harness detects.

### 7.8 Artifact Size Budgets

| ID | Budget | Threshold | Cls | Harness |
| --- | --- | --- | --- | --- |
| `PB-Z1` | Core binary, stripped release | ≤ 18 MB | P | `scripts/size-report.mjs` |
| `PB-Z2` | Shell JS, initial route | ≤ 220 KB gzipped | P | `scripts/size-report.mjs` |
| `PB-Z3` | Per-surface route chunk | ≤ 90 KB gzipped | P | `scripts/size-report.mjs` |
| `PB-Z4` | Windows installer (MSI) | ≤ 30 MB | P | `scripts/size-report.mjs` |
| `PB-Z5` | `@devdesk/plugin-sdk` published bundle | ≤ 40 KB gzipped | P | `scripts/size-report.mjs` |

**`PB-Z5` is a design constraint disguised as a size budget.** DR-4 makes the SDK a permanent compatibility obligation; a small published surface is the cheapest available enforcement of "add nothing to the public API casually." A PR that grows it by 20% is a signal worth a review comment regardless of whether it passes.

### 7.9 Shutdown Budgets

| ID | Budget | Threshold | W | Cls | Harness |
| --- | --- | --- | --- | --- | --- |
| `PB-D1` | Quiescent shutdown → process exit (no plugin consumes its grace) | ≤ 400 ms p95 | W2 | P | `tests/perf/shutdown.bench.rs` |
| `PB-D2` | Bounded worst case → process exit, watchdog-enforced | ≤ 2200 ms hard ceiling | W2 | D | `tests/perf/shutdown.bench.rs` |
| `PB-D3` | Transactional persistence flush: layout, revisions, grants (LC-8) | ≤ 120 ms p95 | W2 | P | `tests/perf/shutdown.bench.rs` |

**`PB-D2` derivation.** `PB-P6` hard terminate (1500 ms) + `PB-D3` persistence (120 ms, budgeted to 500 ms at the tail) + telemetry ring-buffer flush and window teardown (200 ms) = 2200 ms. The watchdog force-exits at this ceiling: LC-7 states that a plugin cannot delay exit, and a ceiling without an enforcer is a hope.

---

## 8. Measurement Methodology

### 8.1 Governing Rule

**MM-1.** A number is a budget measurement only if it was produced on RP-1/RP-2 under RP-3, at a named workload, by the harness named in §7, using the statistic in §8.5. Everything else — including every measurement on a developer machine — is **informational**. §3.3's original interpretation rule is preserved and strengthened: **CI numbers from the reference runner are normative; local numbers are diagnostic.**

### 8.2 Memory Metric

**MM-2.** The metric is **private working set**, summed across the DevDesk process tree (host process plus every webview process it spawns).

| Platform | Source |
| --- | --- |
| Windows | `PROCESS_MEMORY_COUNTERS_EX.PrivateUsage` per process, via `GetProcessMemoryInfo` |
| macOS | `task_vm_info.phys_footprint` per task |
| Linux | `Pss_Anon + Private_Clean + Private_Dirty` from `/proc/<pid>/smaps_rollup` |

**MM-3.** Shared pages are **reported but not charged.** Working set (Windows) and RSS (Linux) both double-count pages shared across a webview process group, which on a 12-surface configuration inflates the total by an amount that varies with the webview runtime's process-reuse policy — a variable DevDesk does not control (C-1). Charging a number the architecture cannot influence produces budget failures no engineer can act on. **This metric choice is a substantial part of why `< 100 MB` and `≤ 320 MB` appeared irreconcilable (CR-2).**

**MM-4.** Every memory measurement is taken after 60 s of enforced idle, following a 30 s settle period after reaching the workload state. Growth observed during the settle period is reported separately, because it is the signal `PB-M7` exists to catch.

### 8.3 CPU Metric

**MM-5.** Core-percent, defined in §7.3, sampled at 1 Hz over the measurement window and reported as the arithmetic mean, with the maximum 1 s sample reported alongside. Both kernel and user time are charged.

**MM-6.** Timer wakeups (`PB-C5`, `PB-C6`) are counted independently of CPU time, because a wakeup pattern that costs little CPU still defeats OS power management and is the mechanism by which a persistent desktop application drains a battery. On Windows the source is ETW timer-set events; on macOS, `powermetrics` task wakeups; on Linux, `/proc/<pid>/timers` plus `perf` timer events.

### 8.4 Latency and Frame Metrics

**MM-7.** IPC latency is measured **end to end in the caller's realm** — from just before `invoke` to just after the promise resolves — not from the Rust command's entry to its return. Serialization, the bridge hop, and deserialization are the costs that matter to the frame budget, and measuring only the Rust body hides them.

**MM-8.** Frame timing is captured through the Chrome DevTools Protocol against the WebView2 instance under test, using presented-frame timestamps rather than `requestAnimationFrame` callback times. The two diverge exactly when a frame is dropped, which is the case the budget exists to detect.

**MM-9.** Every latency and frame budget records `p50`, `p95`, `p99`, and `max`, regardless of which percentile it gates on. The ungated percentiles are the trend series that make slow erosion visible (PF-16).

**MM-10.** The negotiated contract version and the pinned WebView2 build are recorded with every measurement (VER-3), because a webview update is the single most likely cause of an unexplained cross-run shift.

### 8.5 Statistical Method

**MM-11.** Each budget is measured with **20 iterations**, preceded by **3 discarded warm-up iterations**. For process-level budgets an "iteration" is a full launch–measure–exit cycle.

**MM-12.** The reported value is the **median of three independent 20-iteration runs**. A single run's median is too sensitive to one thermal or scheduling excursion to gate a build on.

**MM-13. Validity guard.** If the interquartile range of a 20-iteration set exceeds **25% of that set's median**, the run is **invalid** and is retried once. Three invalid runs is an infrastructure incident: the gate reports `INDETERMINATE`, which **does not pass** and does not fail — it blocks the merge pending investigation. A noisy runner silently passing budgets is worse than a broken runner.

**MM-14. Regression rule (PF-16).** A change fails a `block`-state budget if either holds:
- the absolute threshold is exceeded; or
- the value regresses by **more than 10%** against the trailing 7-run median of the target branch, even while within the absolute threshold.

The second clause is what prevents budgets from being lost gradually, which is how they are actually lost. A regression justified by a deliberate trade-off is landed with an amendment PR recording the new baseline and the reason.

**MM-15.** Zero-valued budgets (`PB-R3`, `PB-X6`, `PB-P9`, `PB-C6`) are exempt from MM-14: any nonzero measurement is a failure, and no percentage relationship applies.

### 8.6 Instrumentation Sources

| Domain | Instrument |
| --- | --- |
| Rust micro-benchmarks | `criterion`, statistics reported per MM-11…MM-13 |
| Rust integration and lifecycle timing | `tracing` spans per the §20.2 taxonomy, exported to the harness |
| Startup phases | `startup.<phase>` spans (LC-4), correlated to shell `performance.mark` entries |
| TypeScript micro-benchmarks | `vitest bench` |
| Frame and paint timing | Chrome DevTools Protocol against WebView2 (MM-8) |
| Process CPU, memory, wakeups | Platform APIs per MM-2 and MM-6 |
| Artifact sizes | `scripts/size-report.mjs` |
| Runtime production parity | The §20.4 metric registry, so shipped behaviour is measured against the same definitions CI gates on (OB-8) |

**MM-16.** Every budget in §7 **MUST** have a corresponding runtime metric named per OB-7 (`devdesk_<subsystem>_<measure>_<unit>`). A budget measurable only in CI cannot be diagnosed from a user's local trace dump (QA-11), which defeats §20.3.

---

## 9. Benchmark Strategy

### 9.1 Harness Inventory

| Harness | Budgets | Runtime | Cadence |
| --- | --- | --- | --- |
| `tests/perf/coldstart.bench.ts` | `PB-S1`…`PB-S8`, `PB-P9` | ~8 min | Every PR |
| `tests/perf/idle.bench.rs` | `PB-M1`…`PB-M5`, `PB-M9`, `PB-C1`…`PB-C3`, `PB-C5`, `PB-C9` | ~6 min | Every PR |
| `tests/perf/idle.bench.ts` | `PB-R3`, `PB-X5` | ~3 min | Every PR |
| `tests/perf/ipc.bench.rs` | `PB-X1`…`PB-X4`, `PB-X6` | ~4 min | Every PR |
| `tests/perf/interaction.bench.ts` | `PB-R1`, `PB-R2`, `PB-R7`, `PB-C7`, `PB-G3`…`PB-G5` | ~7 min | Every PR |
| `tests/perf/theme.bench.ts` | `PB-R4`, `PB-C8`, `PB-M8` | ~3 min | Every PR |
| `tests/perf/effects.bench.ts` | `PB-R5`, `PB-R9` | ~4 min | Every PR |
| `tests/perf/surface.bench.ts` | `PB-R6`, `PB-R8`, `PB-G1`, `PB-G6`, `PB-G8` | ~4 min | Every PR |
| `tests/perf/plugin.bench.rs` | `PB-P1`…`PB-P5`, `PB-P7`, `PB-M6`, `PB-C4`, `PB-C6` | ~5 min | Every PR |
| `tests/perf/layout.bench.rs` | `PB-G2` | ~2 min | Every PR |
| `tests/perf/topology.bench.rs` | `PB-G7` | ~3 min | Every PR |
| `tests/perf/shutdown.bench.rs` | `PB-D1`…`PB-D3` | ~3 min | Every PR |
| `tests/perf/soak.bench.rs` | `PB-M7` | 24 h | Weekly |
| `scripts/size-report.mjs` | `PB-Z1`…`PB-Z5`, `PB-P8` | < 1 min | Every PR |

Per-PR wall clock: approximately 52 minutes on the reference runner, executed in parallel with the rest of the §22.1 pipeline rather than after it.

### 9.2 Harness Obligations

**BS-1.** A harness lands **with the stage that introduces its subsystem** (IG-1). A stage is not complete while a budget scheduled to gate at that stage has no harness.

**BS-2.** Every harness **MUST** be self-validating: it asserts its own preconditions (workload reached, RP-3 satisfied, thermal baseline within tolerance) and reports `INDETERMINATE` rather than a number when they are not met (MM-13).

**BS-3.** Harnesses **MUST NOT** depend on wall-clock time, network access, or real filesystem paths outside a temp root (TS-6). Clock and filesystem are injected; the workload fixture is deterministic.

**BS-4.** A harness reports **every** budget it covers on every run, not only the failing ones. The passing values are the trend series MM-14 depends on.

**BS-5.** Adding a budget without adding it to a harness is prohibited. An unmeasured budget is a preference (PF-3).

### 9.3 Trend Publication and Attribution

**BS-6.** Every run publishes a machine-readable result set to the CI trend store, keyed by commit, budget ID, workload, statistic, and the WebView2 build (MM-10).

**BS-7.** A `block`-state failure surfaces the offending budget, its trailing 7-run series, and its phase or marginal decomposition where one exists (`PB-S8`, `PB-M5`, `PB-C3`). This is why the decompositions are budgets rather than notes: a `PB-S1` failure that also shows `startup.shell` breaching its sub-budget is diagnosed, not bisected.

**BS-8.** Weekly, the soak harness result and the full trend series are summarized into `knowledge/performance/`. `knowledge/` is the research source of truth (`PROJECT_CONSTITUTION.md` §2); trend data MUST NOT accumulate inside `docs/`.

### 9.4 Performance Work Protocol

**BS-9.** PF-15 is restated as a gate: performance work **MUST** be preceded by a recorded measurement in `knowledge/performance/`. A PR whose description claims an optimization without a linked baseline fails review, whatever the diff shows.

**BS-10.** An optimization PR **MUST** report the same budget before and after, from the reference runner. A local before/after is not evidence (MM-1).

---

## 10. Gate Activation Schedule

### 10.1 Gate States

| State | Behaviour |
| --- | --- |
| `off` | No harness exists. The budget is documented and not measured. |
| `report` | Measured and published to the trend series. Never fails a build. |
| `warn` | Annotates the PR on breach; does not block merge. |
| `block` | Fails CI on breach of the absolute threshold or the MM-14 regression rule. |

**GA-1.** A budget **MUST NOT** hold `block` before its harness exists (BS-1) and, for class `G` budgets, before its validating spike (§12) has landed in `knowledge/`. This is the direct resolution of CR-7: a gate whose measurement basis is unproven produces a waiver, and the waiver is permanent.

**GA-2.** Gate state advances **monotonically**: `off → report → warn → block`. Regressing a gate state requires an amendment to this ADR with a stated reason (§13). Turning a gate off to land a change is prohibited; the mechanism for that is MM-14's amendment path.

### 10.2 Schedule

Stages are those of `SYSTEM_ARCHITECTURE.md` §25.1. A budget reaches `block` at the stage where the subsystem it measures is complete.

| Stage | Reaches `block` | Reaches `report` or `warn` |
| --- | --- | --- |
| **0** Foundation | `PB-Z1`, `PB-Z2` (warn) | Reference runner commissioned; SPIKE-P5 lands; all class `G` budgets `report` |
| **1** Contract | `PB-X1`, `PB-X2`, `PB-X3`, `PB-X6`, `PB-P9` | `PB-X4` (warn), `PB-X5` (warn) |
| **2** Platform + Display | `PB-G7` | `PB-S8` `startup.display` (report) |
| **3** Kernel + Storage | `PB-C5`, `PB-X5`, `PB-D3`, `PB-G2` | `PB-M9` (warn), `PB-X7` (warn) |
| **4** Window + Shell | `PB-S1`, `PB-S2`, `PB-S5`…`PB-S8`, `PB-M1`…`PB-M5`, `PB-C1`…`PB-C3`, `PB-R3`, `PB-R6`, `PB-D1`, `PB-D2`, `PB-G1` | `PB-S4` (report), `PB-C9` (report) |
| **5** Theme + Effects | `PB-R1`, `PB-R2`, `PB-R4`, `PB-R5`, `PB-R7`, `PB-R8`, `PB-C7`, `PB-C8`, `PB-M8`, `PB-G3`…`PB-G6` | `PB-R9` (report — §10.4) |
| **6** Widget Runtime | `PB-G8`, `PB-S3` | `PB-Z3` (warn) |
| **7** Plugin Host + SDK | `PB-P1`…`PB-P7`, `PB-M6`, `PB-M10`, `PB-C4`, `PB-C6`, `PB-C10` | `PB-P8` (warn), `PB-Z5` (warn) |
| **8** Hardening | `PB-M7` (weekly), `PB-Z4` (warn) | Full trend series and soak reporting operational |

### 10.3 Runner Policy

**GA-3.** `block`-state budgets are evaluated **only** on the dedicated reference runner (RP-1…RP-3). Cloud-hosted CI runners have no discrete display configuration, no GPU suitable for glass compositing, and inter-run CPU variance that routinely exceeds MM-13's validity threshold. Gating on them would produce failures uncorrelated with the change under review, and the team would learn to re-run until green.

**GA-4.** Hosted runners execute the same harnesses in `report` state on every PR. Their value is catching gross regressions early and cheaply — a 10× change is visible through any amount of noise, and the reference runner then confirms it.

**GA-5.** Commissioning the reference runner is a **Stage 0 deliverable owned by Infrastructure** and blocks every `block`-state gate in the schedule.

### 10.4 Portability Parity

**GA-6.** macOS and Linux (RP-2 secondary references) run the full harness set in `report` state. They gate on **parity**, not on absolute values: a budget that passes on Windows and exceeds **2×** the Windows value on a secondary platform raises an `ARCHITECTURE_CHANGE` issue against §19.

**GA-7.** `PB-R9` (GPU memory) is `report`-only on all platforms. GPU memory accounting differs enough between vendors and drivers that a cross-platform absolute threshold would measure the driver rather than DevDesk. It is retained because its *trend* on a fixed runner is still diagnostic.

---

## 11. Validation Classes

Every budget carries exactly one class. The class states what kind of claim the number makes, which determines what evidence is required to change it.

| Class | Meaning | Amendment Path |
| --- | --- | --- |
| **`D` — Derived** | Arithmetically forced by other budgets or by an OS/hardware constant. Not independently negotiable: changing it without changing its inputs makes the model inconsistent. | Amend the inputs; the derived value follows. Changing a derived value alone is rejected. |
| **`P` — Provisional** | An engineering estimate with no measurement behind it. **Binding today**, expected to move. | Amendment PR to this ADR, linking the measurement in `knowledge/`, approved by the budget owner (§13). |
| **`G` — Prototype-gated** | Provisional **and** dependent on an unvalidated platform assumption. MUST NOT reach `block` before its spike lands (GA-1). | Same as `P`, but the spike is a precondition. |
| **`R` — Ratified** | Measured, stable across ≥ 20 reference-runner runs and ≥ 2 releases. | Superseding ADR. |

**No budget in this document is class `R`.** Nothing has been measured. The first promotions to `R` are expected after Stage 4, when a running system has produced trend data across two releases.

### 11.1 Class Summary

Seventy budgets are defined across §7.

| Class | Count | Budgets |
| --- | --- | --- |
| **`D` Derived** | 13 | `PB-S6`, `PB-S7`, `PB-M3`, `PB-M4`, `PB-C1`, `PB-C5`, `PB-C6`, `PB-R3`, `PB-X5`, `PB-X6`, `PB-P6`, `PB-P9`, `PB-D2` |
| **`G` Prototype-gated** | 17 | `PB-S1`, `PB-S2`, `PB-M2`, `PB-M5`, `PB-M6`, `PB-C7`, `PB-R1`, `PB-R2`, `PB-R9`, `PB-X1`, `PB-X2`, `PB-X3`, `PB-P3`, `PB-P7`, `PB-G3`, `PB-G4`, `PB-G6` |
| **`P` Provisional** | 40 | All others |
| **`R` Ratified** | 0 | — |

**VC-1.** A `D`-class budget's derivation is stated inline in §7 beneath its table. A derivation that cannot be written down means the budget is actually provisional and MUST be reclassified.

**VC-2.** The four derived *models* — startup (`PB-S5` + `PB-S7` → `PB-S1`), memory (`PB-M1` + `PB-M2` → `PB-M3`; `PB-M5`, `PB-M6` as slopes), CPU (`PB-C2` + `PB-C3` + `PB-C4` → `PB-C1`), and shutdown (`PB-P6` + `PB-D3` → `PB-D2`) — are amended **as units**. Amending one component without re-checking its aggregate is the most likely way this register becomes internally inconsistent, and reviewers should treat a single-line change to any of these as suspect.

---

## 12. Prototype Validation Requirements

The class `G` budgets rest on assumptions about Tauri, WebView2, and integrated GPUs that no one on this project has yet measured. Each spike below is a **Stage 0 or Stage 1 deliverable**, produces a document in `knowledge/` (§27.4), and is a precondition for its budgets reaching `block` (GA-1).

| Spike | Output | Validates | Question It Must Answer | Due |
| --- | --- | --- | --- | --- |
| **SPIKE-P5** | `knowledge/performance/reference-profile.md` | The methodology itself | Does the commissioned reference runner satisfy MM-13's variance guard across 100 no-op runs? What is its measured noise floor per harness class? | **Stage 0** — blocks every other spike |
| **SPIKE-P1** | `knowledge/tauri/ipc-transport-benchmarks.md` | `PB-X1`, `PB-X2`, `PB-X3`, `PB-P3` | What are the real p50/p99 costs of `invoke`, `emit` fan-out to 12 listeners, `Channel`, and `ipc::Response` on Tauri v2 + WebView2? Where is the actual payload-size crossover that TR-2's 64 KB threshold asserts? | Stage 1 |
| **SPIKE-P4** | `knowledge/performance/coldstart-window-creation.md` | `PB-S1`, `PB-S2`, `PB-S7`, `PB-S8` | What does creating 12 hidden Tauri windows across 3 monitors actually cost, and is it linear in window count? Does WebView2 process reuse hold at 12 windows? | Stage 1 |
| **SPIKE-P3** | `knowledge/performance/webview-memory-scaling.md` | `PB-M2`, `PB-M5`, `PB-M6`, `PB-G6` | What is the marginal private working set of surface number N, for N = 1…24? Where does WebView2 stop reusing renderer processes, and what is the step cost when it does? | Stage 1 |
| **SPIKE-P2** | `knowledge/glass/backdrop-filter-cost-curves.md` | `PB-R1`, `PB-R2`, `PB-R5`, `PB-R9`, `PB-C7` | What is the frame cost of N live `backdrop-filter` layers at 1440p/144 Hz on Iris Xe class hardware, as a function of blur radius and layer area? At what N does 6.9 ms become unreachable? | Stage 1 (also the empirical basis for TH-7 and `ADR-0011`) |
| **SPIKE-P6** | `knowledge/plugins/worker-overhead.md` | `PB-M6`, `PB-P1`, `PB-P3`, `PB-P7` | What does an idle Web Worker cost in memory and wakeups inside a WebView2 renderer? What is the structured-clone round-trip cost at 1 KB and 4 KB? | Stage 1 (Stage 7 for `PB-P1`) |
| **SPIKE-P7** | `knowledge/rendering/native-drag-path.md` | `PB-G3`, `PB-G4`, `PB-C7` | Does the OS-level window move path (PF-8) hold ≥ 120 fps for 12 windows on 3 monitors, and what is the pointer-down-to-window-follow latency in frames? | Stage 2 |

**PV-1.** A spike that **invalidates** its budget is a success, not a failure. Its output is an amendment PR to this ADR carrying the measured value and the reason the estimate was wrong. Adjusting the *implementation* to hit an estimate that the platform cannot support is prohibited — that is how a budget becomes a fiction the code works around.

**PV-2.** A spike missing its target by **more than 2×** triggers ADR-0001 review trigger T-6 and re-opens the subsystem design that assumed it, not merely the number. `PB-M5` and `PB-R1` are the two most likely to do so, and their designed responses already exist: §26.1 (`SurfaceBackend`) for memory, TH-7 degradation for glass.

**PV-3.** Spike outputs live in `knowledge/` and are referenced from here. Measurement data MUST NOT be inlined into this ADR or into `SYSTEM_ARCHITECTURE.md` (`PROJECT_CONSTITUTION.md` §2, §1.2 of the architecture).

---

## 13. Review Criteria

### 13.1 Ownership

| Scope | Owner | Approval Required From |
| --- | --- | --- |
| Individual thresholds | Core Engineering | Budget owner + one reviewer |
| Reference profile (RP-1…RP-4), runner policy | Infrastructure | Infrastructure + Architect |
| Metrics and statistical method (§8) | Lead Software Architect | Architect + Core Engineering |
| Workload definitions (W0…W3) | Lead Software Architect | Architect; also Product if `PRODUCT_SPEC.md` diverges (ADR-0001 T-9) |
| Gate states and schedule (§10) | Lead Software Architect | Architect |
| Validation class promotion to `R` | Lead Software Architect | Architect + evidence per §11 |

### 13.2 Amendment Rules

**RV-1.** **Tightening** a `P` or `G` threshold requires an amendment PR linking the reference-runner measurement that justifies it. No ADR.

**RV-2.** **Loosening** any threshold requires an amendment PR containing: the measurement, the reason the original estimate was wrong, the architectural change considered instead of loosening, and why it was rejected. Approval per §13.1. **A loosening PR that does not answer the third item is rejected on that basis alone** — the default response to a missed budget is to change the design, not the number.

**RV-3.** Changing a metric definition, the reference profile, or a workload **invalidates every prior measurement**. It requires an ADR amendment, a stated cut-over commit, and a note in `knowledge/performance/` marking the trend discontinuity. Comparing across a methodology change is prohibited.

**RV-4.** Promotion to class `R` requires ≥ 20 reference-runner runs across ≥ 2 releases with the value stable inside MM-13's variance guard.

**RV-5.** Adding a budget requires: an ID in the §7 namespace, a workload, a statistic, a validation class, a harness assignment, and a position in the §10 schedule. A budget missing any of these is not added (BS-5).

### 13.3 Scheduled Reviews

| Trigger | Review Scope |
| --- | --- |
| Each stage exit (§25.1) | Every budget scheduled to reach `block` at that stage: harness exists, spike landed, gate armed (IG-1) |
| Each spike landing in `knowledge/` | The budgets that spike validates; class `G` → `P` or amended |
| Each release | Class `R` promotion candidates (RV-4); trend series for slow erosion (MM-14) |
| WebView2, macOS, or Linux webview major update | Every class `G` budget — the platform assumption underneath them has changed (MM-10) |
| `PRODUCT_SPEC.md` acceptance (Wave 1) | W0…W3 workload definitions against the specified primary configuration (ADR-0001 R-1, T-9) |
| Tauri major version | `PB-X1`…`PB-X7`, `PB-P3` (ADR-0001 T-2) |

### 13.4 Review Questions

Applied to any amendment touching this ADR:

1. Does the change preserve the derived models (VC-2), or does it break an aggregate without amending its components?
2. Is the evidence from the reference runner (MM-1), or from a developer machine?
3. If a threshold loosened, what design change was considered and rejected (RV-2)?
4. Does the change alter a metric, profile, or workload — and if so, is the trend discontinuity recorded (RV-3)?
5. Does every affected budget still have a harness, a workload, a statistic, and a schedule position (RV-5)?
6. Does the change weaken a zero-valued budget (`PB-R3`, `PB-X6`, `PB-P9`, `PB-C6`)? These encode structural properties, not tolerances; loosening one is an architecture change, not a budget change.

---

## 14. Consequences

| # | Consequence |
| --- | --- |
| C-1 | `SYSTEM_ARCHITECTURE.md` §3.3 ceases to be the budget register on merge. §5's mapping table is the migration path for existing references; §3.3 is amended to point here (ADR-0001 C-17). |
| C-2 | **Commissioning the reference runner becomes a Stage 0 deliverable owned by Infrastructure** (GA-5). Every `block` gate depends on it, so it is on the critical path for Stage 4 onward. |
| C-3 | Seven spikes (§12) become Stage 0–2 deliverables. Six of them are Stage 1, and they are the reason Stage 1 is more than contract generation. |
| C-4 | Fourteen harnesses (§9.1) are distributed across stages by BS-1. A stage cannot exit without its harnesses, which raises each stage's cost and removes the option of deferring measurement. |
| C-5 | Per-PR CI wall clock grows by roughly 52 minutes on the reference runner. Accepted: it runs in parallel with the §22.1 pipeline, and the alternative — discovering regressions at release — costs more. |
| C-6 | `.ai/CLAUDE.md`'s performance target block is **superseded**. [`ADR-0003`](./ADR-0003-repository-layout.md) §6 structurally prevents recurrence by prohibiting normative content in per-vendor agent files. |
| C-7 | `PB-M10` fixes the plugin private-state quota at 5 MB, resolving OQ-6's numeric half. The enforcement UX remains open for `ADR-0012`. |
| C-8 | Seventeen budgets cannot gate until their spike lands. Between Stage 0 and Stage 4 the system is measured but substantially ungated — this is stated plainly rather than hidden behind a gate that would be waived. |
| C-9 | Every budget requires a paired runtime metric (MM-16), which increases the §20.4 metric registry's size and makes the observability work in Stage 3 larger than the architecture's §20 alone implies. |
| C-10 | Budgets ratchet (D-6): the register can tighten freely with evidence and loosens only under §13.2 scrutiny. Over the project's life this asymmetry is the mechanism that keeps performance a feature rather than an aspiration. |

---

## 15. Related Documents

| Document | Relationship |
| --- | --- |
| [`ADR-0001-system-architecture.md`](./ADR-0001-system-architecture.md) | Parent. Delegated §3.3 here (RA-4, D-7); its AP-VIII invariant is what this register enforces; its T-1, T-6, T-7, T-9 triggers re-open this ADR |
| [`ADR-0003-repository-layout.md`](./ADR-0003-repository-layout.md) | Companion. Owns `tests/`, `knowledge/`, and `scripts/` placement for every harness and spike named here; §6 prevents the recurrence of CR-1…CR-4 |
| [`docs/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) | §3.1 quality attributes, §3.2 constraints, §17 performance architecture, §20 observability, §21 testing, §25.1 stages — all authoritative; §3.3 superseded |
| `ADR-0011` (planned) | Owns the effect degradation mechanism (TH-7, DD-010) that defends `PB-R5`, `PB-R1`, and `PB-C7` |
| `ADR-0012` (planned) | Owns the plugin sandbox model and OQ-6's enforcement UX for `PB-M10` |
| `knowledge/performance/`, `knowledge/glass/`, `knowledge/tauri/`, `knowledge/plugins/`, `knowledge/rendering/` | Homes for the §12 spike outputs and the §9.3 trend series. All measurement data lives here, never in `docs/` |
| [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) | §2 Three Sources of Truth — the rule that routes measurement to `knowledge/` |

---

**Decision recorded 2026-08-07. Effective on merge to `main`.**

*Threshold amendments follow §13.2. Changes to methodology, profile, or workloads require an amendment to this ADR and an `ARCHITECTURE_CHANGE` issue, per [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) §4.*
