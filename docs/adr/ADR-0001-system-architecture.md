# ADR-0001 — Adopt the DevDesk System Architecture

> **Abstraction Level:** 📙 **Level 2 — Architecture** (per [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md))
> **Source of Truth:** `docs/` — Specifications (*what the system should do*)

---

## Document Control

| Field | Value |
| --- | --- |
| **ADR ID** | `ADR-0001` |
| **Title** | Adopt the DevDesk System Architecture |
| **Status** | `ACCEPTED` |
| **Decision Date** | 2026-08-07 |
| **Effective** | On merge to `main` |
| **Deciders** | Lead Software Architect (owner), Core Engineering, Security, Platform |
| **Governs** | `docs/architecture/SYSTEM_ARCHITECTURE.md` (`ARCH-0001`) and every document that refines it |
| **Supersedes** | — |
| **Superseded by** | — |
| **Amended by** | [`ADR-0002`](./ADR-0002-performance-budgets.md) (§3.3), [`ADR-0003`](./ADR-0003-repository-layout.md) (Appendix A), [`ADR-0004`](./ADR-0004-display-topology-identity-and-transaction-model.md) (§9.3, §9.5, §19.1, DD-009) |
| **Wave** | 0 — Foundation |
| **Reversal Cost** | **Very high.** Every Level 2 and Level 3 artifact is written against this baseline. Reversal after Stage 1 (per `SYSTEM_ARCHITECTURE.md` §25.1) invalidates the generated IPC contract and every subsystem specification. |

### Normative Language

This ADR uses [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) keywords with the meanings defined in `SYSTEM_ARCHITECTURE.md` §1.1.

---

## 1. Context

### 1.1 Where the Repository Stands

DevDesk is a desktop customization platform — a native Rust/Tauri host composing user-authored and third-party surfaces across an arbitrary multi-monitor desktop, with a plugin-first and theme-first extension model. It is explicitly **not** a widget application.

At the time of this decision the repository contains:

- A **governance layer** (Level 1): [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md), [`ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md), [`DECISION_PROCESS.md`](../../governance/DECISION_PROCESS.md), [`VERSIONING.md`](../../governance/VERSIONING.md). These mandate ADRs for architectural change, define the Three Levels of Abstraction, and declare the Three Sources of Truth (`docs/`, `knowledge/`, `.ai/`).
- A **directory skeleton** with no source code. Every `packages/*`, `plugins/`, `themes/`, `widgets/`, `apps/`, `tests/`, `scripts/`, `tools/`, and `configs/*` directory is empty apart from `.gitkeep`.
- One **architecture document**: [`docs/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md), version `1.0.0`, status `PROPOSED`, whose own Document Control block states that it becomes `ACCEPTED` on merge of this ADR.
- **Zero ADRs.** `docs/adr/` contains only `.gitkeep`.

The governance layer therefore mandates a process that has never been exercised, and the architecture document is a proposal with no ratifying instrument. This ADR is that instrument.

### 1.2 What SYSTEM_ARCHITECTURE.md Contains

`SYSTEM_ARCHITECTURE.md` is a 29-section, Level 2 document that defines:

| Concern | Section |
| --- | --- |
| Quality attribute scenarios (QA-1…QA-12), constraints (C-1…C-7), system budgets (B-1…B-12) | §3 |
| System context, actors, trust classification | §4 |
| Process, thread, and concurrency topology | §5 |
| Subsystem decomposition and the acyclic dependency contract | §6 |
| The IPC contract: transport selection, naming, versioning, generation, errors, backpressure | §7 |
| State ownership and the snapshot/delta protocol | §8 |
| Subsystem boundaries: display, theme, plugin, widget runtime, persistence | §9–§13 |
| Lifecycle: cold start, steady state, shutdown, crash recovery | §14 |
| Error, failure, and degradation model | §15 |
| Concurrency model | §16 |
| Performance architecture | §17 |
| Security architecture: trust boundaries, threat model, capability enforcement, CSP, supply chain | §18 |
| Cross-platform architecture | §19 |
| Observability, testing, build and release | §20–§22 |
| Eleven seed design decisions (DD-001…DD-011) | §23 |
| Fifteen enforced anti-patterns (AP-1…AP-15) | §24 |
| Implementation order, language guidelines, Definition of Done, enforcement matrix | §25 |
| Eight designed-for extension seams | §26 |
| Related documents, traceability, and seven open questions (OQ-1…OQ-7) | §27, Appendices C–D |

It carries **194 numbered normative rules** across 26 rule families (§2.2 of this ADR), each anchored to a section and, where mechanically possible, to an enforcement tool.

### 1.3 Why a Ratification ADR Is Required Now

Three forcing functions:

1. **Governance.** `PROJECT_CONSTITUTION.md` §4 and `IMPLEMENTATION_RULES.md` §2 make an ADR mandatory for *any* architectural modification. Introducing an architecture is the largest possible such modification. Without ADR-0001 every subsequent ADR would inherit an unratified premise.
2. **Blocking dependency.** `SYSTEM_ARCHITECTURE.md` §27.3 records ADR-0001 as *"gates all Level 2 work."* No subsystem specification (`WINDOW_AND_DISPLAY.md`, `PLUGIN_ARCHITECTURE.md`, `THEME_ARCHITECTURE.md`, `WIDGET_RUNTIME.md`, `STORAGE_ARCHITECTURE.md`, `SECURITY_MODEL.md`, `IPC_CONTRACT.md`, `PLUGIN_SDK.md`) may be authored until the parent document is normative — otherwise each would be refining a proposal.
3. **Contradiction containment.** The repository currently holds contradictory statements about performance targets and directory structure across five documents (§1.4). Ratifying the architecture without simultaneously designating a resolution mechanism would make the architecture itself a party to the contradiction. This ADR ratifies; [`ADR-0002`](./ADR-0002-performance-budgets.md) and [`ADR-0003`](./ADR-0003-repository-layout.md) resolve.

### 1.4 Known Contradictions at Decision Time

These are **not** resolved by this ADR. They are enumerated here so that ratification is not mistaken for a claim that the document set is coherent, and so that each has a named owner.

| # | Contradiction | Sources | Resolved By |
| --- | --- | --- | --- |
| X-1 | Performance targets stated without percentile, workload, or measurement machine, and numerically inconsistent with `SYSTEM_ARCHITECTURE.md` §3.3 | [`.ai/CLAUDE.md`](../../.ai/CLAUDE.md) §"Performance Targets" vs §3.3 | [`ADR-0002`](./ADR-0002-performance-budgets.md) |
| X-2 | Internal budget conflicts inside §3.3 itself (shutdown vs. shutdown grace; gate states vs. an unresolved reference profile) | §3.3, §11.4, §14.3, Appendix D OQ-7 | [`ADR-0002`](./ADR-0002-performance-budgets.md) |
| X-3 | `crates/` is required by §6.2.1 and Appendix A but absent from `README.md`, `.ai/CONTEXT.md`, `ARCHITECTURE_PRINCIPLES.md` §Level 3, and the filesystem | §6.2.1 vs Level 1 documents | [`ADR-0003`](./ADR-0003-repository-layout.md) |
| X-4 | `docs/research/` exists while `knowledge/` is declared the sole research source of truth | Filesystem vs `PROJECT_CONSTITUTION.md` §2 | [`ADR-0003`](./ADR-0003-repository-layout.md) |
| X-5 | `widgets/` and `plugins/` both claim first-party surface bundles, which DD-008 forbids from diverging | Appendix A vs §23 DD-008 | [`ADR-0003`](./ADR-0003-repository-layout.md) |
| X-6 | ADR numbering in §27.3 collides with the Wave 0 ADR assignments | §27.3 vs this wave | §3.5 of this ADR |
| X-7 | Normative performance content lives in a per-vendor AI context file rather than a Level 2 document | `.ai/CLAUDE.md` vs `ARCHITECTURE_PRINCIPLES.md` §Level 2 | [`ADR-0003`](./ADR-0003-repository-layout.md) §6 |

---

## 2. Problem Statement

**The repository has a mandatory ADR process, a complete architecture proposal, and no mechanism connecting them. Until that connection exists, no engineer or agent can tell which statements in the repository are binding.**

Concretely, four questions have no answer today:

1. **Is `SYSTEM_ARCHITECTURE.md` normative or advisory?** Its own status field says `PROPOSED`. A `MUST` in a proposal is not a `MUST`.
2. **Which document wins when two conflict?** `.ai/CLAUDE.md` states `Idle RAM < 100 MB`; §3.3 states `≤ 320 MB`. Both are in-repo, neither is marked subordinate. A reviewer rejecting a PR has no citable authority.
3. **What may be built next?** §25.1 sequences implementation from Stage 0 through Stage 8 and marks Stage 0 as blocked on an ADR that does not exist. The build order is therefore stalled by construction.
4. **What is the amendment procedure?** §1 of `SYSTEM_ARCHITECTURE.md` requires "an ADR under `docs/adr/`" for modification, but no ADR register, numbering scheme, or precedence rule exists to make that requirement executable.

The problem is **not** whether the architecture is correct — that question is settled by evidence over the project's life, and §27.4 already routes evidence to `knowledge/`. The problem is that an unratified architecture cannot be enforced, cannot be amended, and cannot be refined, so it constrains nothing and unblocks nothing.

---

## 3. Decision

### 3.1 Ratification

**D-1.** [`docs/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) version `1.0.0` is **ACCEPTED** as the architectural baseline of DevDesk. Its status field changes from `PROPOSED` to `ACCEPTED` on merge of this ADR.

**D-2.** All 194 numbered rules enumerated in §2.2 below are **normative**. Their RFC 2119 keywords carry their full weight: a `MUST` violation blocks merge; a `SHOULD` deviation requires written justification in the PR description; a `MAY` is genuinely optional.

**D-3.** The document is **binding on humans and AI agents identically.** `SYSTEM_ARCHITECTURE.md` §25.6 (AI-1…AI-4) is ratified without exception. An agent that finds the document ambiguous MUST raise an `ARCHITECTURE_CHANGE` issue rather than select an interpretation (AI-4).

### 3.2 Precedence Order

**D-4.** Where repository documents conflict on a Level 2 concern, precedence is:

```text
1. An ACCEPTED ADR under docs/adr/          (most recent ADR touching the concern wins)
2. docs/architecture/SYSTEM_ARCHITECTURE.md
3. Subsystem specifications under docs/
4. governance/ documents                     (Level 1 — authoritative on process, not on architecture)
5. .ai/ documents                            (agent context — never normative on architecture)
6. README.md and planning/                   (narrative — never normative)
```

**Rationale.** Level 1 governance is authoritative over *process* (how decisions are made) and *vision* (why the project exists), and subordinate on *architecture* (how the system is decomposed) — that is precisely the separation `ARCHITECTURE_PRINCIPLES.md` establishes. A `README.md` structure block is documentation of the architecture, not a source of it; treating it as authoritative is how X-3 arose.

**D-5.** A conflict discovered between a Level 1 document and this baseline is a **defect in the Level 1 document**, not a licence to deviate. It MUST be filed as an `ARCHITECTURE_CHANGE` issue and corrected by amendment.

### 3.3 Scope of Ratification

**D-6.** Ratified in full and immediately binding:

| Section | Content |
| --- | --- |
| §1–§2 | Document control, normative language, purpose, scope, non-goals |
| §4–§6 | System context, runtime topology, logical architecture, dependency rules |
| §7–§8 | IPC contract, state architecture |
| §9–§13 | Subsystem boundaries and persistence |
| §14–§22 | Lifecycle, error model, concurrency, performance architecture, security, cross-platform, observability, testing, build |
| §23 | DD-001…DD-011 as **decisions of record**, each to be elaborated by its own ADR (§3.5) |
| §24 | AP-1…AP-15 as review-blocking anti-patterns |
| §25 | Implementation order, language guidelines, Definition of Done, enforcement matrix |
| §26 | Extension seams **and the constraints each imposes today** — the constraints are binding now, the features are not built |
| §28, Appendices B–C | Glossary, compatibility matrix, traceability |

**D-7.** Ratified **subject to immediate amendment** by the two companion Wave 0 ADRs:

| Section | Status | Amending ADR |
| --- | --- | --- |
| §3.3 (system budgets B-1…B-12) | Superseded as the authoritative budget register | [`ADR-0002`](./ADR-0002-performance-budgets.md) |
| Appendix A (directory contract) | Superseded as the authoritative layout | [`ADR-0003`](./ADR-0003-repository-layout.md) |
| §27.3 (ADR register) | Superseded by §3.5 of this ADR | This ADR |

`SYSTEM_ARCHITECTURE.md` remains the source for §3.1 quality attribute scenarios, §3.2 constraints, and the *architectural* performance rules PF-1…PF-16; ADR-0002 owns only the **numeric thresholds, workloads, and measurement method**. This split is deliberate: architecture states *that* idle cost is eliminated by design; budgets state *how much* is permitted and *how it is measured*.

### 3.4 Consequential Unblocking

**D-8.** Stage 0 of the implementation order (§25.1) is unblocked on merge of this ADR **and** ADR-0003, which together satisfy IG-2. Stages 1–8 proceed in the declared order.

**D-9.** The eight planned Level 2 subsystem specifications listed in §27.2 may now be authored. Each MUST declare `SYSTEM_ARCHITECTURE.md` as its parent, MUST NOT contradict it, and MUST NOT restate content owned by it (`.ai/CLAUDE.md` §"Documentation Rules": *avoid repeating information owned by another document*).

### 3.5 The ADR Register

**D-10.** The register below is **authoritative** and supersedes `SYSTEM_ARCHITECTURE.md` §27.3, which assigned `ADR-0002` to state ownership and `ADR-0003` to Rust crate layout. Wave 0 assigns `ADR-0002` to performance budgets and `ADR-0003` to repository layout.

> **Amended by [`ADR-0004`](./ADR-0004-display-topology-identity-and-transaction-model.md) §3.6.** This rule originally allocated numbers **by the stage each ADR blocks**, so that the register read as a build sequence. That scheme requires ADRs to be *written* in stage order, and they are not: Sprint 1 Day 3 produced a Stage 2 decision — display topology identity — while the Stage 0 process-model and data-egress decisions remain unwritten. Under stage ordering the next ADR to be decided must claim a number in the middle of the register, which `D-11` then freezes, permanently misordering it.
>
> **Numbers are therefore allocated in decision order.** The register still records what each ADR blocks; it no longer promises that the numbers ascend with the stages. Pre-assigned numbers for undecided ADRs are **provisional and non-binding** — an undecided row's number is a placeholder, not a reservation.

| ADR | Title | Source | Blocks | Status |
| --- | --- | --- | --- | --- |
| `ADR-0001` | Adopt the DevDesk system architecture | `SYSTEM_ARCHITECTURE.md` | All Level 2 work | **ACCEPTED** |
| `ADR-0002` | Performance budgets and measurement methodology | §3.3, X-1, X-2, OQ-6, OQ-7 | Stage 0 exit; all CI perf gates | **ACCEPTED** |
| `ADR-0003` | Repository layout and folder ownership | DD-002, X-3, X-4, X-5, X-7 | **Stage 0** (IG-2) | **ACCEPTED** |
| `ADR-0004` | Display topology identity and transaction model | DD-009 | **Stage 2**; Stage 3 layout binding | **ACCEPTED** |
| — | Process model | DD-006 | Stage 0 | Owed |
| — | Data egress policy | DD-011 | Stage 0 | Owed |
| — | Generated IPC contract | DD-003 | Stage 1 | Owed |
| — | State ownership and the snapshot/delta protocol | DD-001 | Stage 3 | Owed |
| — | Concurrency model | DD-007 | Stage 3 | Owed |
| — | Theme data model | DD-005 | Stage 5 | Owed |
| — | Effect budgeting and degradation | DD-010 | Stage 5 | Owed |
| — | Plugin sandbox model | DD-004 | Stage 7 | Owed |
| — | Plugin parity for first-party surfaces | DD-008 | Stage 7 | Owed |

**D-10a.** An owed ADR is a **required deliverable gating its stage**, whatever number it receives. Beginning a stage without its ADR violates `PROJECT_CONSTITUTION.md` §4. Dropping the pre-assigned numbers removes a false ordering promise; it removes no obligation.

**D-11.** ADR numbers are **immutable once merged**. A superseded ADR keeps its number and gains a `Superseded by` field; it is never deleted, renumbered, or rewritten. The historical record of a decision is as valuable as the decision.

**D-12.** ADR filenames follow `ADR-<4-digit>-<kebab-case-title>.md` under `docs/adr/`. Every ADR MUST carry the Document Control block used by this document, including `Status`, `Deciders`, `Reversal Cost`, and `Supersedes`/`Superseded by`.

**D-13.** Permitted statuses: `PROPOSED` → `ACCEPTED` → (`SUPERSEDED` | `DEPRECATED`), plus terminal `REJECTED`. A `REJECTED` ADR is retained: the reason an alternative was refused is the most frequently re-litigated information in a long-horizon project (C-7).

---

## 4. Accepted Architectural Principles

The principles below are ratified as the **invariant core**. Each is stated once, here, in the form that governs review; the full rules live at the cited sections and are not restated (per the no-duplication rule).

### 4.1 The Nine Invariants

| # | Invariant | Enforcing Rules | Falsifiable By |
| --- | --- | --- | --- |
| **AP-I** | **Layers flow downward, and the graph is acyclic.** L5 → L4 → L3 → L2 → L1; Rust crates form a parallel acyclic graph; no package imports another's internals. | DR-1…DR-8 (§6.3) | `dependency-cruiser`, `scripts/lint-cfg-usage.mjs`, bundle validator |
| **AP-II** | **The Rust core is the single source of truth for state.** The shell holds a projection, never an authority; mutations flow through commands; gaps are detected and re-snapshotted. | ST-1…ST-14 (§8) | Contract tests; revision-gap fixtures |
| **AP-III** | **The IPC contract is generated, versioned independently, and never hand-mirrored.** Transport is chosen by frequency and payload size; every command returns `Result`; unknown fields are ignored. | TR-1…TR-3, IPC-1…IPC-4, VER-1…VER-3, GEN-1…GEN-3, ERR-1…ERR-3, BP-1…BP-4 (§7) | Contract diff gate; negotiation matrix tests |
| **AP-IV** | **The Rust capability gate is the only authorization point.** Identity comes from the trusted window label, never the payload; webview checks are UX, not security; denials are audited. | SEC-1…SEC-20 (§18) | `tests/security/` bypass and impersonation suites |
| **AP-V** | **Untrusted code is sandboxed; untrusted data is parsed at the boundary.** Plugins run in Web Workers without DOM or ambient IO; themes are data and never code; the core never panics on external input. | PL-1…PL-11, TH-1, EM-1…EM-2, RS-5 (§10, §11, §15) | `cargo-fuzz` targets; theme validator; capability negative tests |
| **AP-VI** | **Failure is local by construction.** Every component has a declared blast radius; degradation is explicit, tiered, and observable; Safe Mode is always reachable. | EM-3…EM-6, LC-9, PL-5…PL-7, WR-5 (§14, §15) | Chaos suite: induced worker, webview, storage, and topology faults |
| **AP-VII** | **Concurrency is actor-partitioned, bounded, and cancellable.** No global lock; no lock held across `.await`; every mailbox and every subscription queue is bounded with a declared overflow policy. | CM-1…CM-7, BP-1…BP-4 (§7.6, §16) | `clippy::await_holding_lock`; nightly soak test; drop metrics |
| **AP-VIII** | **Performance is a contract, not an aspiration.** The webview main thread is the scarce resource; work is eliminated before it is optimized; every budget has a harness and a CI gate. | PF-1…PF-16 (§17), thresholds per [`ADR-0002`](./ADR-0002-performance-budgets.md) | `tests/perf/` against the reference profile |
| **AP-IX** | **Platform divergence is explicit, introspectable, and never silent.** All OS behaviour goes through `PlatformBackend`; unsupported paths return `Unsupported` with a reason; the CSS baseline is the intersection of three webviews. | XP-1…XP-6, DR-6 (§19) | Platform contract tests, per OS, every commit |

### 4.2 Ratified Rule Register

All families below are normative. Counts are exact and are the basis for the review checklist.

| Family | Rules | Section | Governs |
| --- | --- | --- | --- |
| `DR` | 8 | §6.3 | Dependency direction, acyclicity, package surface |
| `TR` | 3 | §7.1 | IPC transport selection by frequency and payload |
| `IPC` | 4 | §7.2 | Command/event naming and DTO shape |
| `VER` | 3 | §7.3 | Contract versioning and compatibility |
| `GEN` | 3 | §7.4 | Contract generation and diff gating |
| `ERR` | 3 | §7.5 | Error envelope and information disclosure |
| `BP` | 4 | §7.6 | Backpressure, overflow policy, coalescing |
| `ST` | 14 | §8 | State ownership, snapshot/delta, optimistic mutation |
| `WD` | 9 | §9 | Coordinate spaces, topology identity, surface layers |
| `TH` | 9 | §10 | Theme data model, token pipeline, effect governance |
| `PL` | 11 | §11 | Plugin validation, sandbox, lifecycle, capabilities |
| `WR` | 5 | §12 | Surface lifecycle, isolation, deterministic layout |
| `PR` | 10 | §13 | Storage tiers, layered config, migrations |
| `LC` | 9 | §14 | Cold start, steady state, shutdown, Safe Mode |
| `EM` | 6 | §15 | Errors as values, blast radius, degradation tiers |
| `CM` | 7 | §16 | Actors, bounded mailboxes, lock discipline, cancellation |
| `PF` | 16 | §17 | Work placement, idle elimination, rendering discipline |
| `SEC` | 20 | §18 | Trust boundaries, capability enforcement, CSP, supply chain |
| `XP` | 6 | §19 | Platform trait, divergence, degradation ladder |
| `OB` | 8 | §20 | Structured tracing, span taxonomy, local-only diagnostics |
| `TS` | 8 | §21 | Mandatory coverage, property tests, determinism, fuzzing |
| `BR` | 5 | §22 | Build gates, release profile, artifact signing |
| `IG` | 3 | §25.1 | Stage completion criteria |
| `RS` | 8 | §25.2 | Rust guidelines |
| `TSG` | 8 | §25.3 | TypeScript guidelines |
| `AI` | 4 | §25.6 | AI-assisted development obligations |
| **Total** | **194** | | |

### 4.3 Ratified Non-Goals

The five non-goals in §2.4 are ratified as **hard scope boundaries**, not preferences. Design work that assumes any of them is out of contract:

1. No fixed catalogue of privileged first-party widgets.
2. No web application in a shell — no remote-hosted UI, no runtime code download.
3. No general-purpose scripting host — arbitrary native execution is not an extension mechanism in v1.
4. No feature-parity mandate against any existing tool; compatibility layers are plugins, never core.
5. No server-side or multi-user operation; sync, if ever built, is an opt-in plugin over an explicit boundary.

### 4.4 Ratified Extension Constraints

The eight seams in §26 are **designed for, not built**. What is ratified today is the **constraint each imposes**, because that constraint is the actual present-day cost and the thing reviewers must enforce:

| Seam | Binding Constraint Today |
| --- | --- |
| §26.1 Native surface backends | Contract-layer surface rendering MUST NOT assume DOM availability |
| §26.2 Process-per-surface | Actor messages MUST be serializable; no `Rc`, raw pointers, or non-`Send` across actors |
| §26.3 WASM plugin runtime | Host API MUST remain flat, serializable, capability-scoped; no JS closures across the boundary |
| §26.4 Compatibility layers | Core MUST NOT acquire format-specific knowledge |
| §26.5 Theme expression evaluator | Token resolution and evaluation MUST remain distinct phases; resolution total and cycle-detecting |
| §26.6 Configuration sync | Syncable state MUST be serializable, revision-tagged, and free of machine-local absolute paths |
| §26.7 Scriptable automation | Every user-reachable action MUST be expressible as an IPC command; no UI-only paths |
| §26.8 Marketplace | Bundle signing and capability declaration are built now, not retrofitted |

---

## 5. Rejected Alternatives

Alternatives are evaluated against the *ratification* decision. The alternatives to individual design decisions (DD-001…DD-011) are recorded in §23 of the architecture and elaborated by the per-decision ADRs in the §3.5 register; they are not re-litigated here.

### RA-1 — Defer ratification until subsystem specifications exist

**Proposal.** Author `WINDOW_AND_DISPLAY.md`, `PLUGIN_ARCHITECTURE.md`, and the rest first, then ratify a baseline validated by its children.

**Rejected.** The dependency runs the other way. A subsystem specification refines a parent; without a normative parent, eight authors would each fix the IPC shape, state ownership, and trust model independently, and the "baseline" would then be a retroactive merge of eight incompatible assumptions. This is the failure mode `PROJECT_CONSTITUTION.md` §1 (Modular First) and `SYSTEM_ARCHITECTURE.md` §6.3 exist to prevent. It also leaves Stage 0 blocked indefinitely (IG-2).

### RA-2 — Ratify a principles-only baseline; defer §7, §8, and §18 to subsystem ADRs

**Proposal.** Accept the layering, non-goals, and quality attributes now; leave the IPC contract, state protocol, and security model to be decided alongside their implementations.

**Rejected.** These three are precisely the **cross-cutting seams that cannot be owned by any subsystem**. The IPC contract is consumed by every package and every plugin; state ownership determines whether a frontend store exists at all; the capability gate is the system's only authorization point (SEC-1). Deferring them means each subsystem invents a local answer, and reconciling those answers later is a rewrite, not a refactor — with the added cost that the plugin contract would already be public and therefore frozen (DR-4).

### RA-3 — Adopt a conventional shell architecture with a rich frontend store

**Proposal.** Treat Rust as a thin native-API bridge; hold application state in a TypeScript store (Redux/Zustand/signals) synchronized to disk; let each surface own its own state.

**Rejected.** With 12 surfaces across 3 monitors plus plugin observers, two authorities produce a divergence surface that grows quadratically in observer pairs, and each defect reproduces only under specific timing (DD-001). Additionally, this architecture cannot satisfy AP-IV: a store in the webview cannot be the authorization point for capability-gated data, so the security model would have to be bolted on outside the state path. Single ownership makes the divergence class impossible rather than rare.

### RA-4 — Ratify §3.3 budgets as-is, without a reference profile

**Proposal.** Accept B-1…B-12 with their current gate states and move on; define the measurement machine when the first harness is written.

**Rejected.** Nine of twelve budgets are marked *Blocking* while §3.3's own interpretation rule defers the reference machine profile to `tests/perf/README.md`, a file that does not exist, and Appendix D OQ-7 lists that profile as unresolved. A blocking gate with an undefined measurement basis is not a gate; it is an unenforceable claim that will be waived on its first invocation and never re-armed. Budgets are therefore delegated to [`ADR-0002`](./ADR-0002-performance-budgets.md), which defines the profile, the workloads, the statistics, and a gate-activation schedule tied to Stage exits.

### RA-5 — Ratify Appendix A as the final directory contract

**Proposal.** Accept the architecture's directory tree verbatim; treat the current repository as simply incomplete.

**Rejected.** Appendix A is not merely ahead of the filesystem — it **conflicts** with three Level 1 documents on `crates/` (X-3), leaves `widgets/` and `plugins/` with overlapping responsibility in a way DD-008 forbids (X-5), and does not address `docs/research/` versus `knowledge/` (X-4) or which packages are publishable. Ratifying it verbatim would freeze those conflicts into the baseline. Layout is therefore delegated to [`ADR-0003`](./ADR-0003-repository-layout.md), which is also the instrument that amends the Level 1 documents.

### RA-6 — Treat `SYSTEM_ARCHITECTURE.md` as advisory guidance

**Proposal.** Keep the document as a strong recommendation; let implementation deviate where convenient and reconcile periodically.

**Rejected.** An advisory architecture on a small team with a long horizon (C-7) decays to a historical artifact within one release, because every deviation is locally rational and no deviation is individually large enough to justify a reconciliation. More specifically, the security invariants (AP-IV, AP-V) and the dependency invariant (AP-I) are only meaningful as absolutes: a capability gate that is bypassed "just here" is not a gate, and an acyclic graph with one exemption is a cyclic graph. The document's value is exactly its enforceability.

### RA-7 — Rewrite the architecture to a shorter document before ratifying

**Proposal.** The document is large; condense it to a 5-page overview and ratify that.

**Rejected.** Its length is load-bearing, not decorative: §24's anti-patterns, §7.1's transport matrix, and §18.3's threat model are the parts that make review decidable, and they are the first content a condensation removes. The correct response to size is **navigability and ownership** — which §27.2 already provides by routing detail into eight subsystem documents — not deletion. Where the document does over-reach, the remedy is delegation by ADR (as with §3.3 and Appendix A), not compression.

---

## 6. Rationale

### 6.1 Why This Architecture Fits This Problem

Desktop customization platforms fail in four characteristic ways. The baseline is structured around preventing each, and that mapping is the substance of the decision.

| Characteristic Failure | Structural Prevention |
| --- | --- |
| **"It slowly eats my machine."** Persistent software accrues idle cost: timers, polling, retained layers, listener queues. Users experience it as the application becoming heavier over months. | Idle cost is architecturally eliminated rather than tuned: no polling (PF-4), coalesced core-side timers (PF-5), scoped and ref-counted subscriptions (ST-7, ST-10), suspension of occluded surfaces (PF-6, PL-6), and bounded queues so slow consumers cost bounded memory (BP-1, CM-2). |
| **"My layout is gone."** Docking, undocking, and monitor reordering destroy user arrangements, because monitors are identified by enumeration index. | Topology fingerprinting from display identity, layout persisted per fingerprint, deterministic fallback with one-click restore (WD-3…WD-6). |
| **"A widget took down my desktop."** Third-party code runs in the host's realm with the host's privileges. | Plugins are Trust Zone 2 by definition: Web Worker isolation with no DOM and no ambient IO, capability-gated in Rust with identity from the trusted window label, supervised with backoff and quarantine (§11, §18.4). |
| **"It works on my machine."** Mixed-DPI, multi-webview, integrated-GPU divergence produces defects that reproduce for one user and no one else. | Newtype-tagged coordinate spaces make the common mistake a compile error (WD-1, WD-2, AP-6); the CSS baseline is the three-webview intersection (XP-4); effect degradation is observable rather than silent (TH-8); platform gaps return `Unsupported` rather than no-op (XP-3, AP-15). |

### 6.2 Why the Document's Form Is Correct

Three properties make this document ratifiable in a way that prose architecture usually is not:

1. **Every rule is addressable.** 194 numbered rules mean a review comment cites `ST-12` rather than "this feels wrong," and a lint rule references the identifier it enforces. This is the mechanism by which architecture stays enforced rather than remembered.
2. **Quality attributes are scenarios with response measures** (§3.1, QA-1…QA-12) and are traced to verification (Appendix C). "Fast" is not ratifiable; "12 surfaces, 3 monitors, 60 s idle, ≤ 1.0% of one core, measured by a named harness" is.
3. **Anti-patterns are paired with detection** (§24). Fifteen failure modes are stated as code, with the rule they violate and the tool that catches them. An architecture that only says what to do relies on memory; one that says what will go wrong and how it is caught relies on tooling.

Together with C-5 (AI-assisted development as a first-class workflow), this form is what makes the architecture consumable by agents: `docs/api/contract.schema.json` is the machine-readable API surface (AI-1), and the numbered rules are the machine-checkable review criteria.

### 6.3 Why Ratify Before Any Implementation Exists

The obvious objection is that this architecture is unvalidated: no line of DevDesk code has run. Three reasons ratification is still correct now rather than after a prototype.

1. **The expensive decisions are the irreversible ones, and they are all made at Stage 0–1.** Directory structure, workspace topology, the generated-contract pipeline, state ownership, and the plugin trust model each become effectively permanent the moment a public SDK ships (DR-4, VER-1). Deciding them under a prototype's local pressures is how they get decided badly.
2. **Ratification is the precondition for falsification.** A `PROPOSED` document generates no gates, no harnesses, and no lint rules, so nothing about it can be proven wrong. An `ACCEPTED` one produces §25.5's enforcement matrix and §21's test pyramid, which is the machinery that will surface its errors — and Appendix D already names seven questions expected to change it.
3. **The amendment cost is bounded and the process exists.** `DECISION_PROCESS.md` plus this ADR's register (§3.5) make amendment a routine, low-ceremony act. The asymmetry is decisive: amending a ratified architecture costs one ADR; reconciling eight subsystems built without one costs a rewrite.

`SYSTEM_ARCHITECTURE.md` §25.6 (AI-4) already states the correct posture: ambiguity in the document is a **defect in the document**. Ratification is what makes that statement actionable.

### 6.4 Why the Budgets and Layout Are Split Out

Separating [`ADR-0002`](./ADR-0002-performance-budgets.md) and [`ADR-0003`](./ADR-0003-repository-layout.md) from this ADR is deliberate, not procedural convenience:

- **Different volatility.** The architecture changes rarely; budget thresholds change every time a spike produces evidence (§27.4). Binding them into one ADR would mean every measurement re-opens the architecture.
- **Different deciders.** Budgets are owned by Core Engineering plus Infrastructure (who own the reference runner); layout is owned by the Architect plus whoever holds CODEOWNERS; the baseline is owned by the Architect with Security and Platform review.
- **Different failure modes.** A wrong budget produces a false CI gate; a wrong layout produces churn across every import path; a wrong baseline produces an unbuildable system. They should not fail together.

---

## 7. Consequences

### 7.1 Immediately Binding

| # | Consequence |
| --- | --- |
| C-1 | `SYSTEM_ARCHITECTURE.md` status becomes `ACCEPTED`; its `MUST`s are merge-blocking from this point forward. |
| C-2 | Every PR is reviewed against the §25.4 Definition of Done, including the §24 anti-pattern checklist and the `.ai/SESSION.md` entry when an agent participated. |
| C-3 | The §25.5 enforcement matrix becomes a build requirement. Tooling that does not yet exist (`dependency-cruiser` config, `scripts/lint-cfg-usage.mjs`, `scripts/lint-ipc-hotpath.mjs`, contract diff gate) is now **required work in Stage 0–1**, not optional hardening. |
| C-4 | The §25.1 stage order is binding. Feature work before Stage 1 (the generated contract) is prohibited by IG-3. |
| C-5 | The eight subsystem specifications in §27.2 are unblocked and each is now a tracked deliverable with a declared parent. |
| C-6 | Every per-decision ADR in the §3.5 register becomes a required deliverable, each gating its stage. Beginning a stage without its ADR violates `PROJECT_CONSTITUTION.md` §4 (D-10a). |
| C-7 | Research findings are routed to `knowledge/` (§27.4) and MUST NOT be inlined into architecture documents. |

### 7.2 Costs Accepted

| # | Cost | Why It Is Accepted |
| --- | --- | --- |
| C-8 | **Higher up-front ceremony.** Every architectural change costs an ADR plus an `ARCHITECTURE_CHANGE` issue. | The alternative — silent drift — is the failure mode the governance layer was created to prevent. The cost is paid per *decision*, not per commit. |
| C-9 | **Stage 0–1 produce no user-visible feature.** Foundation, contract generation, and enforcement tooling ship before any surface renders. | IG-3: every later stage consumes the generated contract. Building features first guarantees a migration of every consumer. |
| C-10 | **First-party development is deliberately slower.** DD-008 removes the privileged path, so contract gaps must be fixed rather than routed around. | This is the intended cost of plugin-first. Gaps surface while they are cheap. |
| C-11 | **Plugins cannot manipulate the DOM.** They describe intent; the host renders (DD-004). | This is what makes theme-first work: plugin output is themeable rather than pre-styled. |
| C-12 | **Every mutation is a command round trip**, requiring the optimistic-update protocol (§8.4) for direct manipulation. | Bounded complexity in one protocol versus unbounded divergence bugs across every observer pair. |
| C-13 | **Field diagnostics are user-initiated only** (SEC-18, DD-011): no telemetry, no analytics, no crash upload. | The observability design (§20.3, ring buffer + local dump) compensates deliberately. Trust is the platform's core asset. |
| C-14 | **A core panic ends the session** (DD-006). | Mitigated by EM-2 (no panic on external input), fuzzing (TS-8), crash recovery (§14.4), and Safe Mode (LC-9). Revisitable per §26.2 without redesign. |
| C-15 | **Visual output becomes hardware-dependent** through effect degradation (TH-7). | Made acceptable by making degradation explicit, metered, and visible in developer tools (TH-8) rather than silent. |

### 7.3 Downstream Obligations Created

| # | Obligation | Owner | Due |
| --- | --- | --- | --- |
| C-16 | Amend `SYSTEM_ARCHITECTURE.md` §1 status to `ACCEPTED` and §27.3 to reference §3.5 of this ADR | Architect | Wave 1, first architecture amendment PR |
| C-17 | Amend §3.3 to reference [`ADR-0002`](./ADR-0002-performance-budgets.md) as the budget register | Architect | Wave 1, same PR |
| C-18 | Amend Appendix A to reference [`ADR-0003`](./ADR-0003-repository-layout.md) as the layout contract | Architect | Wave 1, same PR |
| C-19 | Populate `.ai/DECISION_LOG.md` with ADR-0001…ADR-0003 on acceptance, per §27.5 | Architect | Wave 1 |
| C-20 | Update `.ai/CODE_REVIEW.md` to incorporate §24 and §25.4 | Core Engineering | Before Stage 1 |
| C-21 | Resolve OQ-1…OQ-5 by their declared stage deadlines; OQ-6 and OQ-7 are resolved by [`ADR-0002`](./ADR-0002-performance-budgets.md) | Per Appendix D | Per Appendix D |

---

## 8. Risks

Risks are stated with the signal that would indicate the risk has materialized, so that each is monitorable rather than merely acknowledged.

| ID | Risk | Impact | Likelihood | Early Signal | Mitigation |
| --- | --- | --- | --- | --- | --- |
| **R-1** | **The architecture is ratified without a product specification.** §3.1's scenarios encode product assumptions (12 surfaces, 3 monitors, glass as the visual signature) that no ratified product document supports. | High — budgets, layer model, and effect governance are all sized against these assumptions | Medium | Wave 1 `PRODUCT_SPEC.md` states a materially different primary workload or de-emphasizes glass | Wave 1 MUST reconcile `PRODUCT_SPEC.md` against §3.1 and §3.2 explicitly. Divergence is an `ARCHITECTURE_CHANGE` issue amending §3.1 and [`ADR-0002`](./ADR-0002-performance-budgets.md) workloads, not a silent mismatch. |
| **R-2** | **No budget is empirically grounded.** Every §3.3 threshold is an engineering estimate with zero measurements behind it. | High — a systematically wrong budget either blocks all work or gates nothing | High | First spike shows a >2× gap on any prototype-gated budget | [`ADR-0002`](./ADR-0002-performance-budgets.md) classifies every value as derived / provisional / prototype-gated, names the validating spike, and keeps gates non-blocking until their spike lands. |
| **R-3** | **Tauri v2 is a load-bearing external dependency (C-1).** A breaking upstream change, an abandoned capability system, or a WebView2 regression propagates directly into the architecture. | High | Low–Medium | Upstream deprecation of `ipc::Channel`, the capability file format, or the isolation pattern | §7.1's transport abstraction and §19.1's `PlatformBackend` confine the blast radius. A Tauri major version is an explicit review trigger (§9, T-2). |
| **R-4** | **Single-host-process blast radius.** A core panic ends the user's session (DD-006). | High per occurrence | Low, if EM-2 holds | Any panic reaching the crash handler from a parse or IPC path | EM-1/EM-2 at deny level, TS-8 fuzzing on every boundary parser, Safe Mode (LC-9), restart-once policy (§14.4). §26.2 keeps process-per-surface reachable as a transport change. |
| **R-5** | **Enforcement tooling never materializes.** §25.5 lists nine automated gates, four of which are bespoke scripts. If they slip, 194 rules degrade to conventions. | High — the architecture's enforceability is its entire value (RA-6) | Medium | Stage 1 exits with any §25.5 row lacking a CI job | C-3 makes the tooling required Stage 0–1 work. Stage exit criteria (IG-1) MUST include its enforcement rows. |
| **R-6** | **Document scale exceeds maintenance capacity.** A 29-section parent plus 8 subsystem specs plus 13 ADRs is a large surface for a small team (C-7). | Medium — stale specs are worse than absent ones, because they are trusted | Medium | A merged PR contradicts a spec and no one notices in review | Strict single-ownership per §27.2 and no-duplication (each fact has exactly one home); Definition of Done requires spec conformance; `ARCHITECTURE_CHANGE` issues make drift visible. |
| **R-7** | **Over-constraint slows early velocity below viability.** No privileged first-party path (DD-008), no hand-written types (DD-003), no direct `backdrop-filter` (TH-6), no `unwrap` (EM-1). | Medium | Medium | Repeated PR-level requests for exemption to the same rule | A repeated exemption request is **evidence the rule is wrong**, and is routed to an ADR amendment — not granted as a one-off. One-off exemptions are how AP-I and AP-IV die. |
| **R-8** | **Cross-platform parity proves unattainable for Layer 0/3.** GNOME Wayland has no layer-shell; OQ-3 and OQ-5 are unresolved. | Medium — a headline capability may be Windows-only at v1 | Medium–High | OQ-3 resolves with no viable fallback | XP-3 and the §19.3 ladder make the gap explicit and introspectable rather than a silent no-op; OQ-5 decides Layer 0's v1 inclusion before Stage 4. |
| **R-9** | **The webview memory floor invalidates the memory model.** Multi-webview architectures carry a per-surface RSS cost that may exceed the assumed marginal budget. | Medium–High — would force surface pooling or a native backend earlier than §26.1 anticipates | Medium | Prototype shows per-surface marginal RSS materially above the [`ADR-0002`](./ADR-0002-performance-budgets.md) allowance | Prototype-gated budget with a named spike; §26.1's `SurfaceBackend` seam is the designed response, and its constraint (no DOM assumption in the contract layer) is binding today. |
| **R-10** | **Ratification is mistaken for validation.** Teams treat an `ACCEPTED` document as proven and stop testing its premises. | Medium | Medium | `knowledge/` stays empty through Stage 2 | PF-15 requires a recorded measurement before performance work; Appendix D keeps seven questions open by name; §9 review triggers are stated as observable conditions. |

---

## 9. Review Triggers

This ADR and the architecture it ratifies are **re-opened automatically** when any condition below is observed. A trigger obliges an `ARCHITECTURE_CHANGE` issue within one working week; it does not presume the outcome.

| ID | Trigger | Re-opens |
| --- | --- | --- |
| **T-1** | A blocking budget is breached by a change that cannot be fixed without violating a `MUST` | §3.3 scope, [`ADR-0002`](./ADR-0002-performance-budgets.md), and the rule in tension |
| **T-2** | Tauri publishes a major version, or deprecates `ipc::Channel`, the capability file format, or the isolation pattern | C-1, §7.1, §18.5, §18.6 |
| **T-3** | A `PlatformBackend` feature returns `Unsupported` on **two or more** target platforms | §19, §9.4, and the affected feature's v1 scope (OQ-3, OQ-5) |
| **T-4** | The plugin contract requires a MAJOR bump (VER-1) | §7.3, §11.5, ADR-0012, ADR-0013 |
| **T-5** | A capability bypass is demonstrated in `tests/security/` or reported externally | §18 in full, AP-IV; treated as a security incident, not a design discussion |
| **T-6** | A prototype-gated budget misses its target by more than 2× | [`ADR-0002`](./ADR-0002-performance-budgets.md) and the subsystem whose design the budget assumed |
| **T-7** | Per-surface marginal memory or CPU exceeds its allowance at the reference workload | §5.1 process model (DD-006 / ADR-0004), §26.1 surface backends, R-9 |
| **T-8** | The same rule receives exemption requests in three or more PRs | That rule specifically — the rule is presumed wrong until re-argued (R-7) |
| **T-9** | `PRODUCT_SPEC.md` (Wave 1) states a primary workload, monitor count, or visual model inconsistent with §3.1 | §3.1, §3.2, and [`ADR-0002`](./ADR-0002-performance-budgets.md) workload definitions (R-1) |
| **T-10** | A second host process, a second state authority, or a second authorization point is proposed for any reason | AP-II, AP-IV, DD-001, DD-006 — each is an invariant, so the proposal is an architecture change by definition |
| **T-11** | Stage exit is requested with any §25.5 enforcement row lacking a CI job | C-3, IG-1, R-5 |
| **T-12** | An `Unsupported` path or a degradation tier transition is found to be silent in shipped code | EM-5, XP-3, AP-15 — silence is the defect, independent of the feature |

---

## 10. Future Revisions

### 10.1 Scheduled Amendments

| Wave | Amendment | Instrument |
| --- | --- | --- |
| 0 (this wave) | §3.3 budgets superseded; §27.3 register superseded; Appendix A superseded | ADR-0001, [`ADR-0002`](./ADR-0002-performance-budgets.md), [`ADR-0003`](./ADR-0003-repository-layout.md) |
| 1 | Reconcile `PRODUCT_SPEC.md` against §3.1 quality attribute scenarios and §3.2 constraints | `ARCHITECTURE_CHANGE` issue; amendment PR |
| 1 | Apply C-16…C-18 text amendments to `SYSTEM_ARCHITECTURE.md` | Amendment PR, referencing this ADR |
| 1–2 | Author §27.2 subsystem specifications, each declaring this baseline as parent | Eight Level 2 documents |
| Per §25.1 | Each per-decision ADR lands ahead of the stage it blocks | Per §3.5 register |

### 10.2 Expected Revisions

These are anticipated, not defects. Each is expected to arrive with evidence in `knowledge/`.

| Area | Expected Change | Evidence Source |
| --- | --- | --- |
| §3.3 / [`ADR-0002`](./ADR-0002-performance-budgets.md) | Provisional thresholds replaced with measured ones; some tightened, some relaxed | `knowledge/performance/`, `knowledge/glass/` |
| §16, DD-007 | OQ-1 resolves the actor implementation (hand-rolled vs. crate) | `knowledge/rust/` |
| §13 | OQ-2 resolves SQLite access strategy (`rusqlite` + blocking pool vs. `sqlx`) | `knowledge/rust/` |
| §9.4, §19 | OQ-3 and OQ-5 resolve Wayland layer-shell fallback and Layer 0's v1 inclusion | `knowledge/rendering/`, platform spikes |
| §11.2, §18.3 T-7 | OQ-4 resolves signature scheme and key custody | `knowledge/plugins/` |
| §10.3, TH-7 | Degradation ladder thresholds calibrated to measured GPU cost curves | `knowledge/glass/` |
| §5.1, §26.2 | Process model revisited if R-7/R-9 signals appear | `knowledge/performance/`, `knowledge/plugins/` |

### 10.3 What Will Not Be Revised Without a Superseding ADR

The nine invariants in §4.1 and the five non-goals in §4.3 are the **stable core**. They are not amendable by a subsystem specification, a Level 1 document edit, a lint exemption, or accumulated practice. Changing any of them requires an ADR that explicitly supersedes ADR-0001 and states what replaces the invariant — because each is load-bearing for several others, and removing one silently invalidates the rules that assume it.

---

## 11. Related Documents

### 11.1 Governs

| Document | Relationship |
| --- | --- |
| [`docs/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) | The ratified baseline. This ADR is its ratifying instrument and its amendment index. |

### 11.2 Companion ADRs (Wave 0)

| Document | Relationship |
| --- | --- |
| [`ADR-0002-performance-budgets.md`](./ADR-0002-performance-budgets.md) | Supersedes §3.3 as the budget register; defines the reference profile, workloads, methodology, and gate schedule; resolves X-1, X-2, OQ-6, OQ-7 |
| [`ADR-0003-repository-layout.md`](./ADR-0003-repository-layout.md) | Supersedes Appendix A; resolves X-3, X-4, X-5, X-7; unblocks Stage 0 per IG-2 |

### 11.3 Governance — Level 1

| Document | Relationship |
| --- | --- |
| [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) | Parent authority; §4 mandates this ADR's existence; §2's Three Sources of Truth are ratified as a layout constraint by ADR-0003 |
| [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md) | Defines the abstraction level this ADR occupies; its "Strict Decoupling" pillar is implemented by AP-I |
| [`governance/DECISION_PROCESS.md`](../../governance/DECISION_PROCESS.md) | The lifecycle this ADR follows and that §3.5's register schedules |
| [`governance/VERSIONING.md`](../../governance/VERSIONING.md) | Application SemVer; §7.3's independent contract version complements it (BR-5) |

### 11.4 Level 2 Children — Unblocked by This ADR

`docs/architecture/WINDOW_AND_DISPLAY.md` (§9) · `PLUGIN_ARCHITECTURE.md` (§11) · `THEME_ARCHITECTURE.md` (§10) · `WIDGET_RUNTIME.md` (§12) · `STORAGE_ARCHITECTURE.md` (§13) · `SECURITY_MODEL.md` (§18) · `docs/api/IPC_CONTRACT.md` (§7) · `docs/sdk/PLUGIN_SDK.md` (§11.5, §26.3)

### 11.5 AI Agent Context

| Document | Relationship |
| --- | --- |
| [`.ai/AGENTS.md`](../../.ai/AGENTS.md) | Normative agent contract; bound by AI-1…AI-4 and by D-3 of this ADR |
| [`.ai/IMPLEMENTATION_RULES.md`](../../.ai/IMPLEMENTATION_RULES.md) | Repository rules; §25.6 extends them for this architecture |
| [`.ai/CODE_REVIEW.md`](../../.ai/CODE_REVIEW.md) | Review criteria; MUST incorporate §24 and §25.4 (C-20) |
| [`.ai/DECISION_LOG.md`](../../.ai/DECISION_LOG.md) | Running log; ADR-0001…ADR-0003 recorded on acceptance (C-19) |
| [`.ai/SESSION.md`](../../.ai/SESSION.md) | Session record required by `PROJECT_CONSTITUTION.md` §5 and AI-3 |

### 11.6 Research Inputs

Evidence that validates or challenges this baseline belongs in `knowledge/`, routed per §27.4, and never inline in a Level 2 document (`PROJECT_CONSTITUTION.md` §2).

---

**Decision recorded 2026-08-07. Effective on merge to `main`.**

*Amendment to this ADR or to the architecture it ratifies requires a superseding ADR under `docs/adr/` and an `ARCHITECTURE_CHANGE` issue, per [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) §4.*
