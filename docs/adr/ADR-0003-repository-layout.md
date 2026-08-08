# ADR-0003 — Repository Layout, Workspace Topology, and Folder Ownership

> **Abstraction Level:** 📙 **Level 2 — Architecture** (per [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md))
> **Source of Truth:** `docs/` — Specifications (*what the system should do*)

---

## Document Control

| Field | Value |
| --- | --- |
| **ADR ID** | `ADR-0003` |
| **Title** | Repository layout, workspace topology, and folder ownership |
| **Status** | `ACCEPTED` |
| **Decision Date** | 2026-08-07 |
| **Effective** | On merge to `main` |
| **Deciders** | Lead Software Architect (owner), Core Engineering, Platform |
| **Amends** | [`ADR-0001`](./ADR-0001-system-architecture.md) Appendix A delegation — supersedes `SYSTEM_ARCHITECTURE.md` Appendix A as the authoritative directory contract |
| **Implements** | `SYSTEM_ARCHITECTURE.md` DD-002 (the `crates/` decision) |
| **Resolves** | ADR-0001 X-3, X-4, X-5, X-7 |
| **Unblocks** | Stage 0 of `SYSTEM_ARCHITECTURE.md` §25.1, per IG-2 |
| **Wave** | 0 — Foundation |
| **Reversal Cost** | **High and rising.** Every import path, every workspace manifest, every CODEOWNERS rule, and every lint configuration is written against this layout. Reversal is cheap today (the repository holds no source code) and expensive from Stage 1, when the generated contract fixes `packages/shared/src/generated/` as a build output path. |

### Normative Language

RFC 2119 keywords carry the meanings defined in `SYSTEM_ARCHITECTURE.md` §1.1.

### Ownership Boundary

This ADR owns **where things live, what each location is for, who owns it, and what it is named**.

It does **not** own what any subsystem does. `SYSTEM_ARCHITECTURE.md` §6.2 remains authoritative for crate and package *responsibilities*; §5 of this document adds only what §6.2 does not state — directory shape, publishability, and naming — and does not restate responsibilities.

---

## 1. Context

### 1.1 The State of the Repository

At decision time the repository is a directory skeleton. Every source directory contains only `.gitkeep`; there is no `Cargo.toml`, no `package.json`, no `pnpm-workspace.yaml`, and no code. Twenty-three top-level directories exist:

```text
.ai  .github  apps  assets  configs  docs  examples  governance  knowledge
packages  planning  playground  plugins  scripts  tests  themes  tools  widgets
```

This is the cheapest possible moment to fix the layout, and the last moment at which it is free.

### 1.2 Four Documents Describe the Layout, and They Disagree

| Source | Describes |
| --- | --- |
| [`README.md`](../../README.md) §Repository Structure | 13 directories |
| [`.ai/CONTEXT.md`](../../.ai/CONTEXT.md) §Structure Overview | 13 directories |
| [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md) §Three Levels | Assigns directories to abstraction levels |
| `SYSTEM_ARCHITECTURE.md` Appendix A | 19 directories, including `crates/` |

None of the four matches the filesystem. `README.md` and `.ai/CONTEXT.md` omit `governance/`, `planning/`, `playground/`, `configs/`, and `crates/` — the first four of which exist on disk and the fifth of which the architecture requires. `ARCHITECTURE_PRINCIPLES.md` §Level 3 omits `crates/` and `tests/`; its §Level 2 omits `docs/sdk/`. Appendix A includes `crates/` but is annotated *"REQUIRES ADR-0003"* — this ADR.

### 1.3 Why Layout Is an Architectural Concern, Not a Convention

Three of the architecture's normative rule families are enforced **by path**:

- **DR-1…DR-5** are implemented as `dependency-cruiser` rules matching `^packages/(shared|theme-engine|...)/`. A layer's membership is a directory.
- **DR-6** prohibits `#[cfg(target_os)]` outside `devdesk-platform`, checked by `scripts/lint-cfg-usage.mjs` scanning `crates/`. Without `crates/`, that lint has no scope.
- **SEC-10** requires CODEOWNERS protection on `configs/` and `capabilities/`. A CODEOWNERS rule is a path glob; `.github/CODEOWNERS` is currently empty.

A layout disagreement is therefore not cosmetic. It determines whether the architecture's most heavily enforced invariant (ADR-0001 AP-I) has anything to enforce against.

---

## 2. Problem Statement

**The architecture's dependency, platform, and security invariants are enforced by filesystem path, but the repository has no ratified filesystem contract — and its four descriptions of one conflict with each other and with the disk.**

Nine specific defects:

1. **`crates/` does not exist and is not documented at Level 1.** `SYSTEM_ARCHITECTURE.md` §6.2.1 defines seven Rust crates that have no home, and DD-002 marks Stage 0 blocked on this decision (IG-2).
2. **The Rust project location is contested.** [`.ai/SESSION.md`](../../.ai/SESSION.md) records the next step as *"Initialize Tauri / Rust core engine under `apps/`"*, which DD-002 explicitly rejects.
3. **No workspace topology exists** for either toolchain. Where the Cargo workspace root lives determines whether the binary crate and the library crates share a lockfile — and therefore whether they can silently diverge.
4. **`widgets/` and `plugins/` claim the same responsibility.** Appendix A gives `widgets/` *"user-facing surface bundles"* and `plugins/` *"first-party plugins — same contract, no privilege."* DD-008 forbids first-party surfaces from having a separate path.
5. **`plugins/` means two different things.** It is both a repository source directory and, in §11.2 and §18.5, a runtime install root under `$APPDATA`.
6. **`docs/research/` duplicates `knowledge/`,** which `PROJECT_CONSTITUTION.md` §2 declares the sole research source of truth.
7. **`configs/` contains duplicate tool responsibilities** — `biome/` alongside `eslint/` and `prettier/`, and `editor/` alongside the root `.editorconfig` — while lacking directories for three tools the architecture requires (`dependency-cruiser`, `stylelint`, `typescript`).
8. **No package is marked public or internal.** DR-4 makes `@devdesk/plugin-sdk` a permanent compatibility obligation, but nothing states which packages are published, which transitively drags their dependencies into the public surface.
9. **Normative architecture content lives in a per-vendor agent file.** [`.ai/CLAUDE.md`](../../.ai/CLAUDE.md) carries performance targets that [`ADR-0002`](./ADR-0002-performance-budgets.md) supersedes — content that, by `ARCHITECTURE_PRINCIPLES.md`'s own rule, belongs at Level 2.

---

## 3. Contradiction Resolutions

| # | Contradiction | Resolution | Reasoning |
| --- | --- | --- | --- |
| **LR-1** | `crates/` required by §6.2.1 and Appendix A; absent from `README.md`, `.ai/CONTEXT.md`, `ARCHITECTURE_PRINCIPLES.md`, and the filesystem | **`crates/` is created at repository root** as a peer of `packages/` (§4.1). The four Level 1 documents are amended (§8.2). | DD-002's reasoning holds: Rust libraries under `packages/` puts two toolchains in one directory, which breaks the `packages/*` glob assumption that both ecosystems' tooling relies on and makes every `dependency-cruiser` path rule ambiguous. Placing all Rust inside `src-tauri` violates DR-7 and makes the core untestable without the Tauri harness. |
| **LR-2** | `.ai/SESSION.md` records "Initialize Tauri / Rust core engine under `apps/`" | **Superseded.** `apps/desktop/src-tauri/` holds `devdesk-app` and nothing else (§4.2, RL-3). The session log is a historical record and is **not** amended — it accurately records what was decided then. | Amending a historical log to match a later decision destroys the record's value. The log is precedence rank 5 (ADR-0001 D-4) and was never authoritative. |
| **LR-3** | No Cargo or pnpm workspace topology | **One Cargo workspace rooted at the repository root**, members `crates/*` and `apps/*/src-tauri`. **One pnpm workspace rooted at the repository root** (§4.3). | The binary crate lives under `apps/`, so a workspace rooted at `crates/` cannot contain it. Two workspaces means two lockfiles, two `target/` directories, doubled build time, and — decisively — the possibility that the binary links a different version of a shared dependency than the libraries were tested against. One workspace makes that class impossible. |
| **LR-4** | `widgets/` and `plugins/` both claim first-party surface bundles | **`widgets/` is retired as a source directory.** First-party surfaces ship as plugin bundles under `plugins/`. "Widget" is retained as user-facing vocabulary only (§12, WR-1). | This is DD-008 applied to the filesystem. A separate first-party directory *is* the privileged path DD-008 prohibits: it would acquire its own build step, its own conventions, and eventually its own capabilities, and third-party authors would be permanently second-class. The strongest evidence that the contract is sufficient is that first-party code has nowhere else to live. |
| **LR-5** | `plugins/` means both a repository directory and a runtime install root | **Disambiguated by name and by path** (§4.5): repository source is `plugins/<name>/`; the runtime install root is `$APPDATA/DevDesk/plugins/<publisher>.<name>/`, matching the §18.5 asset scope. | The two are different artifacts at different lifecycle stages — source versus installed, unsigned versus signed, workspace member versus user data. Using one word for both is how a path-traversal check ends up validating the wrong root (T-8). |
| **LR-6** | `docs/research/` duplicates `knowledge/` | **`docs/research/` is retired** (§8.3 action item). `knowledge/` is the sole research source of truth. | `PROJECT_CONSTITUTION.md` §2 already decides this; the directory is a leftover. Two homes for research guarantees that half of it is stale, and no reader can tell which half. |
| **LR-7** | `configs/` holds duplicate tool responsibilities and lacks three required ones | **`configs/prettier/` and `configs/editor/` are retired; `dependency-cruiser/`, `stylelint/`, and `typescript/` are added** (§4.6). Biome owns formatting and base linting; ESLint owns only the rules with no Biome equivalent; the root `.editorconfig` is canonical. | Two formatters in one repository produce a diff war on every save. `.editorconfig` must live at the repository root because every editor that reads it looks there — a copy under `configs/` cannot be the one in effect, only the one that disagrees. `dependency-cruiser`, `stylelint`, and TypeScript configs are required by §6.3, §25.5, and TSG-1 respectively. |
| **LR-8** | No package marked public or internal | **Two packages are published: `@devdesk/plugin-sdk` and `@devdesk/shared`. Everything else is `private: true`. All Rust crates are `publish = false`** (§5.3). | DR-4 makes `plugin-sdk` depend only on `shared`; a published package cannot depend on an unpublished one, so `shared` is public **by derivation, not by choice**. Naming this consequence explicitly is the point: it is the reason DR-3 (zero runtime dependencies) matters, and the reason `shared`'s surface must stay minimal. |
| **LR-9** | Normative content in a per-vendor AI file (`.ai/CLAUDE.md` performance targets) | **AID-2: per-vendor files are adapters and MUST NOT contain normative content** (§6). Normative agent obligations live in `.ai/AGENTS.md` and `.ai/IMPLEMENTATION_RULES.md`. | This is a structural fix, not a cleanup. Per-vendor files multiply — four exist already — and normative content in one is invisible to a reader using another. Confining normativity to the vendor-neutral documents makes the divergence that produced ADR-0002 CR-1…CR-4 impossible to repeat. |
| **LR-10** | `ARCHITECTURE_PRINCIPLES.md` level assignments omit `crates/`, `tests/`, `docs/sdk/` | **§4.7 assigns an abstraction level to every top-level directory**, and the Level 1 document is amended to match (§8.2). | A directory with no level assignment is a directory in which any content is arguable. The level map is the mechanism by which "never mix the three levels" (`IMPLEMENTATION_RULES.md` §4) becomes checkable. |

---

## 4. Decision — Repository Layout

### 4.1 Canonical Tree

**RL-1.** The following is the authoritative repository layout. It supersedes `SYSTEM_ARCHITECTURE.md` Appendix A. Adding, removing, or repurposing a **top-level** directory requires an amendment to this ADR.

```text
devdesk/
├── Cargo.toml                      # Cargo workspace root (RL-4)
├── Cargo.lock                      # committed (SEC §18.10)
├── rust-toolchain.toml             # pinned toolchain (BR-4)
├── package.json                    # root scripts only; not a publishable package
├── pnpm-workspace.yaml             # pnpm workspace root (RL-7)
├── pnpm-lock.yaml                  # committed
├── .nvmrc                          # pinned Node version (BR-4)
├── .editorconfig                   # canonical editor config (LR-7)
│
├── apps/                           # L3 · deployable applications
│   └── desktop/
│       ├── src/                    # React shell — the Trust Zone 1 application
│       └── src-tauri/              # devdesk-app binary crate ONLY (DR-7, RL-3)
│           ├── capabilities/       # Tauri capability files — CODEOWNERS protected (SEC-10)
│           ├── tauri.conf.json     # CSP, isolation pattern, asset scope (§18.5)
│           └── src/                # thin composition root
│
├── crates/                         # L3 · Rust libraries (LR-1)
│   ├── devdesk-core/               # state kernel, actors, event bus
│   ├── devdesk-ipc/                # command registry, contract codegen
│   ├── devdesk-platform/           # PlatformBackend trait + per-OS impls
│   ├── devdesk-display/            # monitor topology, DPI, hotplug
│   ├── devdesk-plugin-host/        # manifest, capability gate, supervisor
│   ├── devdesk-storage/            # SQLite WAL, layered config
│   └── devdesk-telemetry/          # tracing, metrics, crash capture
│
├── packages/                       # L3 · TypeScript packages
│   ├── shared/                     # PUBLISHED (LR-8); src/generated/** is output (GEN-1)
│   ├── plugin-sdk/                 # PUBLISHED — the frozen author-facing contract (DR-4)
│   ├── storage/  theme-engine/  effects/  animation/  hooks/  ui/
│   └── widget-engine/
│
├── plugins/                        # L3 · first-party plugin bundles (LR-4, LR-5)
├── themes/                         # L3 · first-party themes — DATA ONLY (TH-1)
├── configs/                        # L3 · shared tool configuration — CODEOWNERS protected
├── scripts/                        # L3 · build, codegen, lint automation
├── tools/                          # L3 · internal developer utilities
├── tests/                          # L3 · cross-cutting suites (§21.1)
├── examples/                       # L3 · reference consumers of the public SDK
├── playground/                     # L3 · experimental spikes — NEVER imported (RL-9)
│
├── docs/                           # L2 · specifications (§5.4)
│   ├── adr/  architecture/  api/  sdk/  product/  design/  development/
├── governance/                     # L1 · constitution, principles, process, versioning
├── planning/                       # L1 · roadmap, backlog, ideas, notes
├── knowledge/                      # Research source of truth (§5.5)
├── .ai/                            # AI agent context source of truth (§6)
├── assets/                         # L3 · static branding and design assets
└── .github/                        # CODEOWNERS, templates, workflows
```

Retired relative to Appendix A and the current filesystem: `widgets/` (LR-4), `docs/research/` (LR-6), `configs/prettier/` and `configs/editor/` (LR-7).

### 4.2 Rust Project Location

**RL-2.** All reusable Rust code lives in `crates/<crate-name>/` at repository root. There is exactly one `crates/` directory and it is never nested.

**RL-3.** `apps/desktop/src-tauri/` contains **only** the `devdesk-app` binary crate. It is a thin composition root (DR-7): Tauri builder wiring, capability files, window creation, and the startup sequence. Any function longer than approximately 30 lines, and any logic that could be unit-tested, MUST be moved to a library crate under `crates/`.

**RL-4.** The seven crates in §4.1 are the complete Rust decomposition for v1. Adding a crate requires an amendment to this ADR, because a new crate is a new node in the dependency graph that DR-1 and DR-2 govern.

**RL-5.** `crates/devdesk-platform/` is the only crate permitted `#[cfg(target_os = ...)]` for implementation selection (DR-6). Its per-OS implementations live in `src/windows/`, `src/macos/`, and `src/linux/`, each gated at module level rather than at statement level, so that an unsupported path is a missing implementation rather than a silently empty function body (AP-15).

### 4.3 Workspace Topology

**RL-6 — Cargo.** One workspace, rooted at the repository root:

```toml
# Cargo.toml — the shape is normative; versions are not
[workspace]
resolver = "2"
members  = ["crates/*", "apps/*/src-tauri"]

[workspace.package]
edition = "2021"
license = "see LICENSE"
publish = false                      # LR-8: no Rust crate is published in v1

[workspace.dependencies]
# every third-party version is declared once, here; member crates use `workspace = true`

[workspace.lints.clippy]
unwrap_used         = "deny"         # RS-1 / EM-1
expect_used         = "deny"
panic               = "deny"
await_holding_lock  = "deny"         # CM-3
```

**RL-6a.** Third-party dependency versions are declared **once** in `[workspace.dependencies]`. A member crate declaring its own version of a shared dependency is prohibited: divergent versions of `serde` or `tokio` across crates produce link-time duplication that presents as inexplicable trait mismatches.

**RL-6b.** The RS-1 lint set is declared in `[workspace.lints]`, not per crate. A crate cannot opt out. `EM-1` is only meaningful as an absolute (ADR-0001 RA-6), and a per-crate lint block is an opt-out mechanism.

**RL-7 — pnpm.** One workspace, rooted at the repository root:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "plugins/*"
  - "tools/*"
  - "examples/*"
  - "tests"
```

**RL-8.** `themes/*` is **not** a workspace member. Themes are data (TH-1); they have no `package.json` and no build step. Listing them would imply buildability and create the exact affordance — "just add a small build script" — that TH-1 exists to foreclose.

**RL-9.** `playground/*` is **not** a workspace member. This is deliberate and load-bearing: a playground package would make `@devdesk/*` specifiers resolve into experimental code, and an accidental import from production would type-check and build. Exclusion makes `ARCHITECTURE_PRINCIPLES.md`'s Playground Prototyping pillar structurally enforced rather than remembered. Spikes in `playground/` use relative imports or their own local dependencies.

**RL-10.** `tests` is a single workspace package, not a glob. The cross-cutting suites share fixtures, harness utilities, and the reference-workload definitions from [`ADR-0002`](./ADR-0002-performance-budgets.md) §6.2; splitting them into per-suite packages would duplicate all three.

**RL-11.** Both lockfiles (`Cargo.lock`, `pnpm-lock.yaml`) are committed and CI installs with `--frozen-lockfile` / `--locked` (§18.10).

### 4.4 Test Placement

**RL-12.** Unit tests are **colocated** with the code they test: `#[cfg(test)]` modules in `crates/*/src/`, and `*.test.ts` / `*.spec.tsx` beside their source in `packages/*/src/`. A unit test in `tests/` is a unit test that has lost its subject.

**RL-13.** `tests/` holds only suites that span more than one package or crate, per §21.1:

```text
tests/
├── contract/      # IPC schema conformance, both directions (TS-1)
├── platform/      # PlatformBackend semantic parity, per OS (XP-5)
├── integration/   # core + storage + plugin host, no UI
├── e2e/           # real windows, real monitors (virtualized)
├── perf/          # ADR-0002 harnesses + fixtures/ + README.md → ADR-0002 §6.1
└── security/      # capability bypass, impersonation, fuzz corpora (TS-8)
```

**RL-14.** `tests/perf/README.md` MUST link to [`ADR-0002`](./ADR-0002-performance-budgets.md) §6.1 for the reference profile and MUST NOT restate it (ADR-0002 RP-4, CR-9).

### 4.5 Plugin and Theme Placement

**RL-15.** First-party plugin bundles live at `plugins/<name>/`, where `<name>` is kebab-case and carries no publisher prefix. Each is a pnpm workspace member with the §11.2 bundle structure. First-party bundles are built from source and are **not** committed in built form.

**RL-16.** The **runtime** install root is `$APPDATA/DevDesk/plugins/<publisher>.<name>/`, matching the §18.5 asset-protocol scope. It is user data and is never a repository path. Path validation in `devdesk-plugin-host` canonicalizes against this root and no other (T-8).

**RL-17.** First-party plugins declare `"id": "devdesk.<name>"` in their manifest and receive **no** privileged capability, no manifest exemption, and no separate validation path (DD-008, PL-1). They are validated by the same gate as any third-party bundle.

**RL-18.** `themes/<name>/` contains token files and static assets only. Any executable content — JavaScript, WASM, shell script, or a template language with side effects — fails validation at load (TH-1). No `package.json`, no build step, no workspace membership (RL-8).

### 4.6 Configuration Placement

**RL-19.** `configs/<tool>/` holds shared tool configuration that more than one package consumes. A tool used by exactly one package configures it locally.

| Directory | Tool | Consumed By | Status |
| --- | --- | --- | --- |
| `configs/biome/` | Biome | All TS/JS — formatting and base linting | Existing |
| `configs/eslint/` | ESLint | Rules with no Biome equivalent: `import/no-restricted-paths` (DR-2, DR-5), React hooks, colour-literal ban (TH-2) | Existing |
| `configs/stylelint/` | Stylelint | `backdrop-filter` isolation (TH-6), hardcoded visual values (TH-2) | **Add** |
| `configs/dependency-cruiser/` | dependency-cruiser | DR-1…DR-5 (§6.3) | **Add** |
| `configs/typescript/` | TypeScript | Shared `tsconfig` base carrying TSG-1 compiler flags | **Add** |
| `configs/tailwind/` | TailwindCSS | Shell and UI package, consuming theme tokens as CSS variables | Existing |
| `configs/vite/` | Vite | Shell and package build | Existing |
| `configs/tauri/` | Tauri | Shared bundler and updater configuration | Existing |
| `configs/prettier/` | — | — | **Retire** (LR-7) |
| `configs/editor/` | — | — | **Retire** (LR-7) — root `.editorconfig` is canonical |

**RL-20.** `configs/` and `apps/desktop/src-tauri/capabilities/` are CODEOWNERS-protected (SEC-10). A change to either requires security review sign-off on the PR.

### 4.7 Abstraction Level Assignment

**RL-21.** Every top-level directory is assigned exactly one abstraction level. This makes `IMPLEMENTATION_RULES.md` §4's "never mix the three levels" checkable rather than aspirational.

| Level | Directories |
| --- | --- |
| **📘 L1 — Vision** | `governance/`, `planning/`, `README.md` |
| **📙 L2 — Architecture** | `docs/` (all subdirectories), `packages/plugin-sdk/` (its published surface is a contract) |
| **📗 L3 — Implementation** | `apps/`, `crates/`, `packages/` (except the SDK's public surface), `plugins/`, `themes/`, `configs/`, `scripts/`, `tools/`, `tests/`, `examples/`, `playground/`, `assets/` |
| **Cross-cutting** | `knowledge/` (research — §5.5), `.ai/` (agent context — §6), `.github/` (repository operations) |

**RL-22.** `knowledge/` and `.ai/` are **deliberately outside the level hierarchy.** They are the second and third of the Three Sources of Truth (`PROJECT_CONSTITUTION.md` §2), which is an orthogonal axis: `docs/` says what the system should do, `knowledge/` says what has been learned, `.ai/` says how agents operate. Forcing them into a level would make one of the two taxonomies wrong.

---

## 5. Ownership

### 5.1 Folder Ownership Map

**OW-1.** Every directory has exactly one accountable owner. The CODEOWNERS column is the glob that `.github/CODEOWNERS` MUST implement (§8.3).

| Path | Owner | Contains | MUST NOT Contain |
| --- | --- | --- | --- |
| `governance/` | Lead Architect | Constitution, principles, decision process, versioning | Architecture detail, implementation detail |
| `planning/` | Product + Architect | Roadmap, backlog, ideas, meeting notes | Anything normative |
| `docs/adr/` | Lead Architect | Decisions of record, per the ADR-0001 §3.5 register | Speculation; a decision not yet made |
| `docs/architecture/` | Lead Architect | Level 2 subsystem specifications | Product narrative, code, measurements (§1.2) |
| `docs/api/` | Core Engineering | Wire-level command/event catalogue; **generated** `contract.schema.json` | Hand-written mirrors of generated types (AP-13) |
| `docs/sdk/` | Core Engineering | Public SDK reference, stability tiers | Internal API documentation |
| `docs/product/` | Product | Product specification, user-facing requirements | Architecture decisions |
| `docs/design/` | Design + Architect | Visual and interaction specification, token taxonomy intent | Component implementations, hardcoded values |
| `docs/development/` | Core Engineering | Contributor handbook: setup, build, release runbooks, testing guide | Architecture decisions; duplicated spec content |
| `knowledge/` | Whoever ran the experiment | Benchmarks, spikes, vendor evaluations, trend summaries | Specifications, decisions |
| `.ai/` | Lead Architect | Agent contract, rules, review criteria, prompts, logs | Normative Level 1 or Level 2 content (AID-1) |
| `apps/desktop/src/` | Core Engineering | React shell | Business logic belonging to a package; direct `invoke` (TSG-8) |
| `apps/desktop/src-tauri/` | Core Engineering | `devdesk-app` composition root | Testable logic (DR-7) |
| `apps/desktop/src-tauri/capabilities/` | **Security** | Tauri capability files | A blanket capability across window classes (SEC-8) |
| `crates/devdesk-platform/` | Platform | `PlatformBackend` and per-OS implementations | Policy decisions (§6.2.1) |
| `crates/*` (others) | Core Engineering | Per §6.2.1 | Another crate's responsibility |
| `packages/plugin-sdk/` | **Lead Architect** | The frozen public contract | Any dependency other than `@devdesk/shared` (DR-4) |
| `packages/shared/` | Core Engineering | Environment-agnostic types and utilities | React, DOM, or Tauri imports (DR-3) |
| `packages/shared/src/generated/` | **Codegen — no human owner** | Generated contract types | Hand edits of any kind (GEN-1) |
| `packages/*` (others) | Core Engineering | Per §6.2.2 | Another package's responsibility |
| `plugins/` | Core Engineering | First-party bundles | Privileged capabilities or exemptions (LR-17) |
| `themes/` | Design | Token files and static assets | Executable content of any kind (TH-1) |
| `configs/` | **CODEOWNERS-protected** | Shared tool configuration | Package-local configuration (RL-19) |
| `scripts/` | Core Engineering | Build, codegen, lint automation | Application logic |
| `tools/` | Core Engineering | Internal developer utilities | Anything production code imports |
| `tests/` | Core Engineering | Cross-cutting suites (RL-13) | Unit tests (RL-12) |
| `examples/` | Core Engineering | Reference consumers of the **public** SDK only | Imports of internal packages (§6.4) |
| `playground/` | Anyone | Experimental spikes | Anything production code imports (RL-9) |
| `assets/` | Design | Static branding and design assets | Runtime-loaded theme assets (those live in `themes/`) |
| `.github/` | Lead Architect | CODEOWNERS, templates, workflows | — |

### 5.2 Package Responsibilities

**OW-2.** Crate and package responsibilities are defined by `SYSTEM_ARCHITECTURE.md` §6.2.1 and §6.2.2 and are **not restated here**. This section adds only the structural obligations §6.2 does not state.

**OW-3.** Every TypeScript package has this shape:

```text
packages/<domain>/
├── package.json          # name, exports map, private|publishConfig, deps
├── tsconfig.json         # extends configs/typescript base
├── README.md             # one screen: what it owns, what it does not, entry points
└── src/
    ├── index.ts          # the ONLY public entry point (DR-5)
    └── internal/         # unexported; importable only from within this package
```

**OW-4.** The `exports` field of `package.json` **is** the package's public surface. Anything not listed is internal, and `dependency-cruiser` plus `import/no-restricted-paths` enforce it (DR-5, AP-4). A package with no `exports` map is misconfigured, not permissive.

**OW-5.** Every crate and package carries a `README.md` stating, in one screen: what it owns, what it explicitly does not own, its entry points, and its layer. This is the local restatement of §6.2's boundary — the only permitted duplication of that content, because it is the copy an engineer actually reads before adding a file.

**OW-6.** A domain name is **shared across the IPC boundary**: `crates/devdesk-storage` and `packages/storage` are the same domain on two sides of a seam and are renamed together. A `packages/*` name with no `crates/*` counterpart (`ui`, `effects`, `animation`, `hooks`, `widget-engine`, `plugin-sdk`) is presentation-side only and has no core counterpart by design.

### 5.3 Public versus Internal Packages

**PK-1.** Exactly two packages are **published**:

| Package | Registry | Versioning | Why |
| --- | --- | --- | --- |
| `@devdesk/plugin-sdk` | npm | Independent SemVer; MAJOR tracks the contract MAJOR (Appendix B) | The author-facing contract. DR-4 makes every addition a permanent obligation. |
| `@devdesk/shared` | npm | Independent SemVer, locked in step with `plugin-sdk` | **Derived, not chosen.** DR-4 permits `plugin-sdk` to depend only on `shared`; a published package cannot depend on an unpublished one. |

**PK-2.** Every other `@devdesk/*` package, every `apps/*`, `tools/*`, `examples/*`, `plugins/*`, and `tests` sets `"private": true`.

**PK-3.** All Rust crates set `publish = false` (RL-6). The plugin contract is expressed in TypeScript (DD-003, DD-004); publishing Rust crates would create a second public API surface carrying its own compatibility obligation, for no present consumer. Revisit only if §26.3 (WASM plugin runtime) lands, since a WASM host interface would have Rust-side consumers.

**PK-4.** A change to a **published** package's public surface requires: an ADR when the change is breaking (VER-1), CODEOWNERS review in all cases, an API-surface report committed and diff-reviewed, and adherence to the two-MINOR deprecation window (VER-1). Internal packages have none of these obligations and move freely — that asymmetry is the entire reason for drawing the line.

**PK-5.** `@devdesk/shared`'s published surface is kept **minimal and additive**. DR-3 (zero runtime dependencies) is what makes publishing it safe; a runtime dependency added to `shared` becomes a transitive dependency of every plugin ever written.

**PK-6.** `examples/` may import **only** published packages. An example importing `@devdesk/ui` or `@devdesk/widget-engine` demonstrates something a plugin author cannot do, which makes it a misleading example and a de facto privileged path (DD-008).

### 5.4 Documentation Ownership

**DO-1.** `docs/` is the sole home of specifications (`PROJECT_CONSTITUTION.md` §2). Each subdirectory has a parent document that owns its scope:

| Directory | Parent Document | Scope |
| --- | --- | --- |
| `docs/adr/` | ADR-0001 §3.5 register | Decisions of record |
| `docs/architecture/` | `SYSTEM_ARCHITECTURE.md` | Subsystem specifications refining the baseline |
| `docs/api/` | `IPC_CONTRACT.md` (planned) | Wire-level catalogue; generated schema |
| `docs/sdk/` | `PLUGIN_SDK.md` (planned) | Public SDK reference, stability tiers |
| `docs/product/` | `PRODUCT_SPEC.md` (Wave 1) | Product requirements |
| `docs/design/` | `DESIGN_SYSTEM.md` (planned) | Visual and interaction specification |
| `docs/development/` | `DEVELOPMENT.md` (planned) | Contributor handbook and runbooks |

**DO-2.** Every specification declares its parent, its abstraction level, and its ADR references, and MUST NOT restate content owned by another document. Cross-reference instead (`.ai/CLAUDE.md` §Documentation Rules).

**DO-3.** `docs/api/contract.schema.json` is **generated output** (GEN-3). It is committed so that reviewers and agents can diff the true API surface, and it is regenerated in the same task as `packages/shared/src/generated/contract.ts` — never separately. Hand-editing it is prohibited on the same terms as GEN-1.

**DO-4.** Measurement data, benchmark results, and vendor evaluations **MUST NOT** appear in `docs/`. They belong in `knowledge/` (§1.2 of the architecture, `PROJECT_CONSTITUTION.md` §2). A specification cites a `knowledge/` document; it does not embed its numbers.

**DO-5.** Level 1 documents (`README.md`, `governance/`, `planning/`) MUST NOT contain normative architecture. Where they describe architecture — such as a repository structure block — the description is **documentation of** this ADR and is amended when this ADR changes (ADR-0001 D-4, D-5).

### 5.5 Research Ownership

**KN-1.** `knowledge/` is the sole research source of truth. It holds benchmark results, spikes, vendor evaluations, and trend summaries.

**KN-2.** Subdirectories are **research topics, not architectural terms**, and are open-ended by domain. The eight listed in `SYSTEM_ARCHITECTURE.md` §27.4 are indicative, not exhaustive; the eleven that exist today (`effects`, `experiments`, `glass`, `performance`, `plugins`, `react`, `rendering`, `rust`, `tauri`, `widgets`, `windows`) are all valid, and adding one requires no ADR.

**KN-3.** Consequently, `knowledge/widgets/` is **not** renamed for the surface/widget vocabulary rule. §12 binds *internal identifiers in code*; it does not bind the name of a research topic, and churning `knowledge/` for terminology consistency would break every existing citation for no gain.

**KN-4.** A research document reporting measurements MUST record the machine profile, the date, and the pinned webview or toolchain build, so that a later reader can tell whether the numbers are still comparable ([`ADR-0002`](./ADR-0002-performance-budgets.md) MM-10, RV-3).

**KN-5.** Research documents are `kebab-case.md`. They are **not** amended when superseded — a new document is added and the old one is linked as superseded. A benchmark is a historical fact about a build; rewriting it destroys the trend.

**KN-6.** PF-15 makes `knowledge/` a **precondition for performance work**, not a byproduct: a performance PR without a linked baseline in `knowledge/performance/` fails review ([`ADR-0002`](./ADR-0002-performance-budgets.md) BS-9).

---

## 6. AI Documentation Ownership

**AID-1.** `.ai/` is the sole home of agent context and is **never normative on architecture** (ADR-0001 D-4, precedence rank 5). Content in `.ai/` that contradicts `docs/` is a defect in `.ai/`.

**AID-2.** `.ai/` files are classified, and the classification is binding:

| File | Class | Contains | MUST NOT Contain |
| --- | --- | --- | --- |
| `AGENTS.md` | **Normative, vendor-neutral** | The agent contract: sources of truth, documentation discipline, architecture integrity obligations | Vendor-specific invocation detail |
| `IMPLEMENTATION_RULES.md` | **Normative, vendor-neutral** | Repository rules: git workflow, ADR requirement, level discipline, session logging, playground isolation | Architecture decisions (those are ADRs) |
| `CONTEXT.md` | **Normative, vendor-neutral** | Repository philosophy and the Three Sources of Truth | A repository structure block that duplicates §4.1 — it references this ADR instead (DO-5) |
| `CODE_REVIEW.md` | **Normative, vendor-neutral** | Review criteria, incorporating §24 anti-patterns and §25.4 Definition of Done | Criteria contradicting the Definition of Done |
| `CLAUDE.md`, `CHATGPT.md`, `COPILOT.md`, `ANTIGRAVITY.md` | **Vendor adapter** | Vendor-specific invocation, tool configuration, and **pointers** to the normative documents above | **Any normative content**: architecture, performance targets, security rules, or process (AID-3) |
| `PROMPTS/` | Asset | Reusable prompt templates | Normative content |
| `DECISION_LOG.md` | Record | Running log of accepted ADRs (§27.5) | Decisions not recorded as ADRs |
| `SESSION.md` | Record | Per-session agent log required by `PROJECT_CONSTITUTION.md` §5 and AI-3 | Retroactive edits (LR-2) |

**AID-3.** A per-vendor file **MUST NOT** contain normative architecture, performance, security, or process content. This resolves LR-9 structurally: the four performance targets in `.ai/CLAUDE.md` that [`ADR-0002`](./ADR-0002-performance-budgets.md) supersedes could only have diverged because a vendor file was permitted to be normative. A reader using a different agent would never have seen them.

**AID-4.** Adding a new vendor adapter file requires no ADR. Adding normative content to any `.ai/` file requires the content to live in `docs/` or `governance/` first, with `.ai/` referencing it.

**AID-5.** Agents are bound by the same contracts as humans (AI-1…AI-4, ADR-0001 D-3), including the Definition of Done and the `.ai/SESSION.md` entry. `.ai/` describes *how* an agent operates; it never relaxes *what* the agent must satisfy.

---

## 7. Naming Conventions

**NC-1.** Naming is normative. Inconsistent naming defeats path-based enforcement (§1.3) and makes automated review unreliable.

| Kind | Convention | Example |
| --- | --- | --- |
| Rust crate directory and package name | `devdesk-<domain>`, kebab-case | `crates/devdesk-plugin-host/` |
| Rust library target | `devdesk_<domain>`, snake_case | `devdesk_plugin_host` |
| Binary crate | package `devdesk-app`, binary `devdesk` | `apps/desktop/src-tauri/` |
| Rust modules and files | `snake_case.rs` | `capability_gate.rs` |
| Rust domain ID types | `PascalCase` newtypes; bare `String` IDs prohibited (RS-3) | `PluginId`, `SurfaceId` |
| TS package directory | `<domain>`, kebab-case, no prefix | `packages/widget-engine/` |
| TS package name | `@devdesk/<domain>` | `@devdesk/widget-engine` |
| TS source files | `kebab-case.ts` | `use-core-state.ts` |
| React component files | `PascalCase.tsx`, matching the exported component | `GlassSurface.tsx` |
| Colocated tests | `*.test.ts`, `*.spec.tsx`, `#[cfg(test)]` | `resolver.test.ts` |
| Level 2 specification | `UPPER_SNAKE_CASE.md` | `PLUGIN_ARCHITECTURE.md` |
| Governance document | `UPPER_SNAKE_CASE.md` | `VERSIONING.md` |
| ADR | `ADR-<4-digit>-<kebab-case-title>.md` | `ADR-0003-repository-layout.md` |
| Research note | `kebab-case.md` | `backdrop-filter-cost-curves.md` |
| Plugin repository directory | `<name>`, kebab-case, no publisher prefix | `plugins/system-monitor/` |
| Plugin identifier (manifest) | `<publisher>.<name>` | `devdesk.system-monitor` |
| Theme directory | `<name>`, kebab-case | `themes/midnight-glass/` |
| Tool configuration directory | `configs/<tool>/`, tool's own name | `configs/dependency-cruiser/` |
| Performance harness | `<domain>.bench.{rs,ts}` | `tests/perf/ipc.bench.rs` |
| Automation script | `kebab-case.mjs` | `scripts/lint-ipc-hotpath.mjs` |
| IPC command / event / DTO | Per `SYSTEM_ARCHITECTURE.md` §7.2 | `display_list_monitors`, `display:topology-changed` |
| Runtime metric | `devdesk_<subsystem>_<measure>_<unit>` (OB-7) | `devdesk_ipc_command_duration_ms` |
| Budget identifier | `PB-<class><n>` per [`ADR-0002`](./ADR-0002-performance-budgets.md) §7 | `PB-M5` |
| Git branch | `<type>/<issue>-<kebab-summary>` | `feat/42-topology-fingerprint` |

**NC-2.** Directory names are lowercase kebab-case without exception. Case-insensitive filesystems on Windows and macOS make a case-only rename effectively impossible to land cleanly, so the rule prevents the situation rather than handling it.

**NC-3.** No file uses a default export (TSG-4). A file's name and its exported symbol names are the same identifier for search purposes; default exports break that and defeat rename refactors.

**NC-4.** Generated files live under a directory literally named `generated/` and carry a do-not-edit header. Both the directory name and the header are checked in CI (GEN-1).

---

## 8. Rejected Alternatives

### RA-1 — Rust crates under `packages/`

**Proposal.** Put Rust libraries beside TypeScript packages: `packages/devdesk-core/`, `packages/ui/`.

**Rejected.** Both ecosystems treat their package directory as a homogeneous glob. `pnpm-workspace.yaml` would attempt to resolve Rust directories; `dependency-cruiser` path rules for DR-1…DR-5 would need to exclude them by name, which is a list that silently rots as crates are added. Worse, the layer rules in §6.3 are expressed as `^packages/(shared|theme-engine|…)/` patterns — mixing toolchains makes every one of those patterns ambiguous, and DR-2 is the invariant with the most enforcement weight in the system (ADR-0001 AP-I). This is DD-002's stated reasoning and it holds.

### RA-2 — All Rust inside `apps/desktop/src-tauri/`

**Proposal.** Skip `crates/`; put the kernel, platform layer, and plugin host inside the Tauri binary crate as modules.

**Rejected.** It violates DR-7 directly, and it makes the core untestable without booting the Tauri harness — `devdesk-core`'s actor model, `devdesk-display`'s coordinate math, and `devdesk-storage`'s migrations are all pure logic that should be tested in milliseconds without a window. It also forecloses §26.2 (process-per-surface), which depends on the actor boundaries being real crate boundaries rather than module boundaries inside one binary.

### RA-3 — A Cargo workspace rooted at `crates/`

**Proposal.** Keep the Rust workspace self-contained: `crates/Cargo.toml` as the workspace root, with `src-tauri` as a separate standalone crate.

**Rejected.** The binary is under `apps/`, outside `crates/`, so it cannot be a member. Two workspaces means two `Cargo.lock` files and two `target/` directories: build times roughly double because nothing is shared, and — the decisive problem — the binary can resolve a different version of `tokio` or `serde` than the libraries were tested against. Version skew between a binary and its own libraries produces failures that reproduce only in the packaged build.

### RA-4 — Keep `widgets/` with a narrowed meaning

**Proposal.** Retain `widgets/` for first-party *surface* bundles and reserve `plugins/` for extension-only plugins that provide no surface.

**Rejected.** The distinction is not stable. A surface plugin and a non-surface plugin use the same manifest, the same capability model, the same lifecycle FSM, and the same validation gate; the only difference is whether the manifest declares a `surfaces` array. Splitting the directory on a manifest field creates a boundary that every author must reason about and that no tool can enforce, and it recreates the two-tier structure DD-008 exists to prevent — because whichever directory the first-party team uses daily becomes the well-supported one. Retiring `widgets/` costs one word of vocabulary and removes a whole class of drift.

### RA-5 — Keep `docs/research/` for "applied" research and `knowledge/` for "raw" findings

**Proposal.** Two research homes distinguished by maturity.

**Rejected.** The boundary is unfalsifiable — no one can say when a finding becomes applied — so in practice both directories fill with the same material and readers must check two places. `PROJECT_CONSTITUTION.md` §2 already made this decision; the correct action is to honour it, not to reinterpret it. Where a finding has become normative, its home is `docs/` as a specification, not a second research directory.

### RA-6 — Publish every `@devdesk/*` package

**Proposal.** Publish the full package set so that plugin authors can use `@devdesk/ui` components and `@devdesk/widget-engine` primitives.

**Rejected.** Every published package is a permanent compatibility obligation with a deprecation window (VER-1), on a small team with a long horizon (C-7). More fundamentally, it collapses the plugin contract: DR-4 and DR-8 exist so that a plugin's entire dependency on DevDesk is one versioned surface. If plugins can import `@devdesk/ui`, then internal component refactors become breaking changes for third parties, and the SDK stops being the contract. The two-package surface is the smallest one that makes plugin authoring possible.

### RA-7 — Populate CODEOWNERS from directory conventions rather than an explicit map

**Proposal.** Skip §5.1; let ownership follow from whoever most recently touched a directory.

**Rejected.** SEC-10 requires *security sign-off* on `configs/` and `capabilities/` — an ownership claim that cannot be derived from git history, because history reflects who wrote the code, not who is accountable for it. Implicit ownership also fails exactly at the boundaries that matter most: `packages/shared/src/generated/` has **no** human owner (GEN-1), and no convention expresses that.

---

## 9. Rationale

### 9.1 Layout Is the Enforcement Substrate

The architecture's most heavily enforced rule family — DR-1…DR-8, ADR-0001's AP-I invariant — is implemented entirely as path predicates. A layer is a directory; a public surface is an `exports` map; a platform exemption is a crate path. When the layout is ambiguous, every one of those predicates becomes approximate, and an approximate acyclicity check is not an acyclicity check.

This is why layout is decided at Level 2 by ADR rather than left to convention. It is not filing; it is the substrate the invariants are written on.

### 9.2 Structural Prevention over Documented Prohibition

Three decisions here prevent a class of error rather than prohibiting it:

- **`playground/` is excluded from the workspace** (RL-9). The prohibition already exists in `ARCHITECTURE_PRINCIPLES.md` and `IMPLEMENTATION_RULES.md` §6. Exclusion makes an accidental production import fail to resolve rather than fail review.
- **`themes/` is excluded from the workspace** (RL-8). TH-1 already says themes are data. Excluding them removes the affordance — no `package.json`, so no build script, so no path by which a theme acquires executable content.
- **Vendor adapter files cannot be normative** (AID-3). The prohibition on Level-2 content in `.ai/` already follows from the precedence order. Making it a file-class rule means the divergence that produced ADR-0002 CR-1…CR-4 has no place to recur.

In each case the documented rule already existed and was violated anyway. The structural version is the one that holds.

### 9.3 Retiring `widgets/` Is DD-008 Applied to the Filesystem

DD-008 states that first-party surfaces have no privileged path, and its rationale is precise: a privileged internal path stays convenient while the public path stays underpowered, and third-party authors become permanently second-class.

A separate first-party directory **is** that privileged path, one level below the API. It would acquire its own build configuration, its own testing conventions, and eventually its own capability shortcuts — each individually reasonable, collectively fatal to the contract. Forcing first-party surfaces into `plugins/`, validated by the same gate, means the first time the contract is insufficient the first-party team feels it immediately, while it is cheap to fix. That is precisely the cost DD-008 declared it was buying (ADR-0001 C-10).

### 9.4 Two Public Packages, and Why the Second One Is Not a Choice

`@devdesk/shared` is published because `@devdesk/plugin-sdk` depends on it and DR-4 forbids the SDK from depending on anything else. That derivation is worth stating plainly because it changes how `shared` must be maintained: it is not an internal convenience package, it is the second half of the public API, and DR-3's zero-runtime-dependency rule is what keeps that safe. A single runtime dependency added to `shared` becomes a transitive dependency of every plugin ever written against DevDesk.

The alternative — duplicating the needed types into `plugin-sdk` — trades a published package for a hand-maintained mirror of generated types, which is AP-13 by another name.

### 9.5 Why the Filesystem Is Not Changed in This Wave

This ADR is documentation-only by the scope of Wave 0. Creating directories, writing manifests, and populating CODEOWNERS are Stage 0 implementation work, sequenced by §25.1 and listed as action items in §10.3.

The separation is intentional. A decision and its execution are reviewed differently: this document is reviewed for whether the layout is right; the Stage 0 PR is reviewed for whether it matches the layout. Merging them would mean reviewing a `Cargo.toml` and a `widgets/` deletion in the same pass as the reasoning that justifies them — and the reasoning is what needs the attention.

---

## 10. Consequences

### 10.1 Immediately Binding

| # | Consequence |
| --- | --- |
| C-1 | `SYSTEM_ARCHITECTURE.md` Appendix A is superseded by §4.1 on merge. |
| C-2 | **Stage 0 is unblocked** (IG-2). It was the last gate on the architecture's implementation order. |
| C-3 | Adding, removing, or repurposing a top-level directory now requires an amendment to this ADR (RL-1). |
| C-4 | Adding a Rust crate requires an amendment to this ADR (RL-4), because it adds a node to the DR-1/DR-2 graph. |
| C-5 | `configs/` and `capabilities/` are CODEOWNERS-protected; changes require security sign-off (RL-20, SEC-10). |
| C-6 | Only `@devdesk/plugin-sdk` and `@devdesk/shared` may be published. Publishing anything else requires an amendment (PK-1). |
| C-7 | Normative content may not be added to any `.ai/` file; it goes to `docs/` or `governance/` first (AID-4). |
| C-8 | `examples/` may import only published packages (PK-6), which constrains what examples can demonstrate — deliberately, since a plugin author is under the same constraint. |

### 10.2 Amendments Required to Existing Documents

Applied in Wave 1 as a single amendment PR referencing this ADR. **No file is modified in this wave.**

| Document | Amendment |
| --- | --- |
| `SYSTEM_ARCHITECTURE.md` Appendix A | Replace the directory tree with a reference to §4.1 of this ADR |
| `SYSTEM_ARCHITECTURE.md` §27.4 | Note that `knowledge/` subdirectories are open-ended (KN-2) |
| [`README.md`](../../README.md) §Repository Structure | Replace the 13-directory block with the §4.1 top-level set: add `crates/`, `governance/`, `planning/`, `playground/`, `configs/`; remove `widgets/` |
| [`.ai/CONTEXT.md`](../../.ai/CONTEXT.md) §Structure Overview | Same correction; per DO-5 and AID-2, prefer a reference to §4.1 over a duplicated block |
| [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md) | §Level 2: add `docs/sdk/`. §Level 3: add `crates/`, `tests/`, `tools/`, `examples/`; remove `widgets/`. §Core Pillars: point Performance to [`ADR-0002`](./ADR-0002-performance-budgets.md) |
| [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) §1 | Replace "widgets (`widgets/`)" with "plugins (`plugins/`)" (LR-4) |
| [`.ai/IMPLEMENTATION_RULES.md`](../../.ai/IMPLEMENTATION_RULES.md) §4 | Align the Level 3 directory list with RL-21 |
| [`.ai/CLAUDE.md`](../../.ai/CLAUDE.md) | Reduce to a vendor adapter (AID-2, AID-3): remove the Performance Targets block — superseded by [`ADR-0002`](./ADR-0002-performance-budgets.md) — and the architecture and documentation rule blocks, replacing them with references to `AGENTS.md`, `IMPLEMENTATION_RULES.md`, and the ADR register |
| [`.ai/AGENTS.md`](../../.ai/AGENTS.md) | Absorb the vendor-neutral obligations removed from `CLAUDE.md`; add AI-1…AI-4 and ADR-0001 D-3 |
| `.ai/SESSION.md` | **Not amended** (LR-2) — it is a historical record |

### 10.3 Stage 0 Action Items

Executed in the Stage 0 implementation PR, not in this wave.

| # | Action |
| --- | --- |
| A-1 | Create root `Cargo.toml` per RL-6, `rust-toolchain.toml`, and `.nvmrc` |
| A-2 | Create `pnpm-workspace.yaml` per RL-7 and root `package.json` (scripts only, not publishable) |
| A-3 | Create `crates/` with the seven crate skeletons from §4.1, each with `README.md` per OW-5 |
| A-4 | Create `apps/desktop/` with `src/` and `src-tauri/` (binary crate only, per RL-3) |
| A-5 | Retire `widgets/` (LR-4) and `docs/research/` (LR-6) |
| A-6 | Retire `configs/prettier/` and `configs/editor/`; add `configs/dependency-cruiser/`, `configs/stylelint/`, `configs/typescript/` (LR-7) |
| A-7 | Populate `.github/CODEOWNERS` from the §5.1 map, including the security-owned paths (SEC-10) and the no-human-owner rule for `packages/shared/src/generated/` |
| A-8 | Create `tests/` subdirectories per RL-13, including `tests/perf/README.md` linking to [`ADR-0002`](./ADR-0002-performance-budgets.md) §6.1 (RL-14) |
| A-9 | Add `package.json` with an `exports` map and `private`/`publishConfig` for every package per OW-3, OW-4, PK-1, PK-2 |
| A-10 | Add `README.md` to every crate and package per OW-5 |
| A-11 | Author the `dependency-cruiser` configuration implementing DR-1…DR-5 against the §4.1 paths |
| A-12 | Apply the §10.2 amendments in a single PR referencing this ADR |

---

## 11. Risks

| ID | Risk | Impact | Early Signal | Mitigation |
| --- | --- | --- | --- | --- |
| **R-1** | **Two workspace managers at one root.** Cargo and pnpm both claim the repository root, and tooling that assumes a single-ecosystem repository (IDE indexers, some CI actions, release automation) may misdetect the project type. | Medium — friction, not correctness | An IDE or CI action indexes only one ecosystem | The split is explicit and conventional for Tauri projects. `docs/development/` documents the dual-toolchain setup as its first runbook. |
| **R-2** | **Retiring `widgets/` is felt as a loss of a first-party home.** Under pressure, the team recreates it or adds a manifest exemption. | High — it is DD-008 failing in practice | A PR proposing `widgets/`, a "first-party only" manifest flag, or a capability that skips the gate | ADR-0001 T-10 treats a second privileged path as an architecture change by definition. LR-17 states the no-exemption rule where an implementer will read it. |
| **R-3** | **`@devdesk/shared` accretes surface** because it is convenient and every package already depends on it, and its published status makes each addition permanent. | High — an oversized public surface cannot be reduced without a MAJOR | `shared`'s API-extractor report grows faster than `plugin-sdk`'s | PK-4 requires an API report diff on every published-surface change; PK-5 and DR-3 keep the constraint visible; `PB-Z5` makes SDK growth measurable. |
| **R-4** | **Ownership map and CODEOWNERS diverge.** §5.1 is prose; `.github/CODEOWNERS` is the enforced artifact. | Medium — SEC-10's security review silently stops applying | A `configs/` or `capabilities/` PR merges without security review | A-7 derives CODEOWNERS from §5.1 rather than authoring it independently; a CI check asserting that every §5.1 path has a matching CODEOWNERS rule is Stage 0 work. |
| **R-5** | **Crate decomposition proves wrong.** Seven crates are chosen before any code exists; the real boundaries may differ — `devdesk-display` and `devdesk-core`'s layout actor are the most likely to merge or split. | Medium — a crate split after Stage 3 touches every dependent | Repeated cross-crate `pub(crate)` widening, or a crate that is never independently testable | RL-4 makes crate changes an amendment rather than a refactor, so the discussion happens once. The cost is highest at Stage 3 and low before it. |
| **R-6** | **Amendment lag.** §10.2's Level 1 corrections slip, leaving `README.md` describing `widgets/` after it is deleted. | Medium — the contradiction this ADR resolves silently returns | Wave 1 closes with §10.2 incomplete | A-12 makes the amendments a single tracked PR rather than a diffuse cleanup; ADR-0001 D-5 classifies the resulting mismatch as a defect in the Level 1 document. |
| **R-7** | **Path-based lint rules become brittle.** DR-1…DR-5 are regex predicates over §4.1; a rename that is correct architecturally breaks the enforcement silently by matching nothing. | Medium — a lint that matches nothing passes | A dependency-cruiser rule reports zero violations *and* zero matched modules | The configuration MUST assert non-empty match sets for each rule, so a rule that has stopped applying fails rather than passes. This is Stage 0 work under A-11. |

---

## 12. Review Triggers

| ID | Trigger | Re-opens |
| --- | --- | --- |
| **T-1** | A new top-level directory or a new Rust crate is proposed | RL-1, RL-4, and the §5.1 ownership map |
| **T-2** | A package is proposed for publication beyond `plugin-sdk` and `shared` | PK-1…PK-6, DR-4 |
| **T-3** | A first-party surface requires a capability, manifest field, or build path unavailable to third parties | LR-4, LR-17, DD-008 — and ADR-0001 T-10 |
| **T-4** | `@devdesk/shared` acquires a runtime dependency | DR-3, PK-5, R-3 |
| **T-5** | §26.3 (WASM plugin runtime) is scheduled | PK-3 — Rust crates may need publishing for a host-interface consumer |
| **T-6** | A path-based lint rule matches zero modules | R-7, §4.1 path stability |
| **T-7** | A `.ai/` vendor adapter is found to contain normative content | AID-3 — and the content is relocated, not the rule |
| **T-8** | A second research or specification home is proposed | LR-6, KN-1, DO-1, `PROJECT_CONSTITUTION.md` §2 |
| **T-9** | The Cargo or pnpm workspace is proposed to be split | LR-3, RL-6, RL-7 |
| **T-10** | `PRODUCT_SPEC.md` (Wave 1) implies a deliverable with no home in §4.1 | §4.1 and §5.1 |

---

## 13. Related Documents

| Document | Relationship |
| --- | --- |
| [`ADR-0001-system-architecture.md`](./ADR-0001-system-architecture.md) | Parent. Delegated Appendix A here (RA-5, D-7); its AP-I invariant is what this layout makes enforceable; D-4's precedence order is the basis for DO-5 and AID-1 |
| [`ADR-0002-performance-budgets.md`](./ADR-0002-performance-budgets.md) | Companion. This ADR places its harnesses (`tests/perf/`), its spike outputs (`knowledge/`), and its size-report script (`scripts/`); §6 structurally prevents the recurrence of its CR-1…CR-4 |
| [`docs/architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) | §6.2 crate and package responsibilities and §6.3 dependency rules are authoritative and not restated; Appendix A superseded; DD-002 implemented |
| [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) | §1 Modular First and §2 Three Sources of Truth are the constraints §4 and §5 implement; §1 requires the LR-4 amendment |
| [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md) | Its Three Levels are assigned to directories by RL-21; its Zero Documentation Bloat pillar is implemented by DO-2 and DO-4 |
| [`.ai/AGENTS.md`](../../.ai/AGENTS.md) · [`.ai/IMPLEMENTATION_RULES.md`](../../.ai/IMPLEMENTATION_RULES.md) | The normative agent documents under AID-2; both receive §10.2 amendments |
| `docs/development/DEVELOPMENT.md` (planned) | Owns the dual-toolchain setup runbook implied by R-1 |

---

**Decision recorded 2026-08-07. Effective on merge to `main`.**

*Amendment requires an amendment PR to this ADR and an `ARCHITECTURE_CHANGE` issue, per [`governance/PROJECT_CONSTITUTION.md`](../../governance/PROJECT_CONSTITUTION.md) §4.*
