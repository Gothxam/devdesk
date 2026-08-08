# DevDesk — Project Context

**The identity document of this repository. Read this before writing any code, specification, or documentation.**

> **Abstraction Level:** 📘 **Level 1 — Vision** (per [`governance/ARCHITECTURE_PRINCIPLES.md`](governance/ARCHITECTURE_PRINCIPLES.md))
> **Authority:** Definitive on **vision, product scope, boundaries, philosophy, positioning, vocabulary, and non-goals.**
> **Not authoritative on:** architecture rules, performance thresholds, or repository layout — see §0.2.
> **Version:** `1.3.0` — see §0.5
> **Status:** 🔒 **FROZEN.** This document is immutable. It changes only by an accepted ADR — see §0.6 and §31.4.

---

## 0. How to Use This Document

### 0.1 What This Document Is For

DevDesk's repository contains a governance layer, a ratified system architecture, and three accepted ADRs. All of them describe **how** the system is built. None of them records **why it exists, who it is for, or what it must feel like to use** — and without that, every downstream decision is made against a guess.

This document supplies the missing half. It exists so that an engineer or an AI agent joining at any point can understand DevDesk's intent without access to any prior conversation, and can tell a proposal that serves the project from one that merely compiles.

**Read this first. Every time.** Not because it is longer or more important than the architecture, but because it is the only document that tells you what the architecture is *for*.

### 0.2 Precedence — Read First, But Not Supreme Over Everything

There is a distinction here that matters, and getting it backwards causes real damage.

| Question | Authority |
| --- | --- |
| *What are we building and why? Who is it for? What must it never become? What ships in V1?* | **This document** |
| *How is the system decomposed? What are the contracts, boundaries, and invariants?* | [`docs/architecture/SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md) |
| *What has been formally decided, and what superseded what?* | [`docs/adr/`](docs/adr/) — ADR-0001 §3.5 holds the register |
| *How much may it cost, and how is that measured?* | [`ADR-0002`](docs/adr/ADR-0002-performance-budgets.md) |
| *Where does everything live?* | [`ADR-0003`](docs/adr/ADR-0003-repository-layout.md) |

This document is **read first** and is **supreme on vision and scope**. It is **not** supreme on architecture: [`ADR-0001`](docs/adr/ADR-0001-system-architecture.md) §3.4 sets the precedence order, and a Level 1 document does not override a ratified architectural rule.

The reconciliation is the project's central working principle:

> **Vision drives architecture. Architecture does not drive vision.**

Which means: when this document and the architecture conflict, **the architecture is presumed wrong and the conflict is escalated to an `ARCHITECTURE_CHANGE` issue** — it is not silently resolved in either direction, and it is never resolved by an engineer choosing at the keyboard. The architecture exists to serve what is written here. If it has stopped doing so, that is a defect in the architecture, and the ADR process is how it gets fixed.

### 0.3 What This Document Must Never Contain

Per the no-duplication rule that governs this repository, this document **MUST NOT** restate:

- normative architectural rules (they live in `SYSTEM_ARCHITECTURE.md`, numbered and enforced);
- performance thresholds as independent claims (they live in ADR-0002, with workloads and measurement method);
- directory structure (it lives in ADR-0003 §4.1);
- implementation detail of any kind.

Where this document touches those subjects, it states **intent and rationale** and **references** the owning document. If you find a rule here that is enforced nowhere else, that is a bug in this document — the rule belongs at Level 2.

### 0.4 The One Exception — Cited Numbers

A vision that says "fast" commits to nothing, and §6.2 exists because of exactly that objection. So one narrow exception applies, and it is narrow on purpose:

**A performance number may appear in this document only as a citation of an ADR-0002 budget ID.** Never as a free-standing target, never with its own workload or method, never as a number this document invented.

Two consequences follow, and both are binding:

1. **If a number here and the same budget in ADR-0002 ever disagree, ADR-0002 wins and this document is the defect.**
2. **A vision commitment that has no budget ID is not a commitment** — it is a wish, and the correct response is to open a budget for it, not to write a number here.

This keeps §6.2 measurable without creating a second, unenforced set of targets — which is precisely the failure that produced ADR-0002 in the first place.

### 0.5 Revision History

| Version | Change |
| --- | --- |
| `1.0.0` | Initial synthesis from the project's conversational history and the ratified repository baseline |
| `1.1.0` | Reviewer revision: measurable vision outcomes (§6.2); explicit V1 scope (§7); product boundaries (§3); philosophy split into Parts I–IV; "Linux flexibility" defined concretely and de-risked (§12); terminology restructured to one authoritative definition per term (§28) |
| `1.2.0` | Added the Design Debt Policy (§22) — the merge gate that keeps the §23 boundaries enforceable in practice. Sections from §22 onward renumbered by one |
| `1.3.0` | **Current, and the last version amendable without an ADR.** Frozen by decision of the project owner: this document is now immutable and changes only by an accepted ADR (§0.6, §31.4) |

### 0.6 This Document Is Frozen

**As of `1.3.0`, PROJECT_CONTEXT.md is immutable.**

It is not edited to reflect a new idea, a changed plan, a lesson learned, or a convenient reinterpretation. **It changes only when an ADR under [`docs/adr/`](docs/adr/) is accepted that explicitly amends it** — and the ADR, not the edit, is where the reasoning lives.

Three consequences follow immediately, and all three are the point rather than side effects:

1. **Downstream documents may not "correct" this one.** A specification, an ADR, or a plan that assumes something different from what is written here is either wrong or is proposing an amendment. There is no third case, and no silent third case in particular.
2. **The reconciliation obligation in §31.3 now runs one way.** The architecture answers to this document, and the way it stops answering is by amending it on the record — not by drifting from it.
3. **Open questions close by ADR, not by edit.** `Q-1` and `Q-2` (§7.3) and the provenance gaps in §30.2 cannot be resolved by revising this text. `Q-1`/`Q-2` need an ADR; the provenance gaps are closed by `DESIGN_SYSTEM.md` and `PRODUCT_SPEC.md` producing the missing detail *elsewhere* (§30.3).

The full mechanism — what counts as an amendment, what counts as editorial, and how an amending ADR is numbered — is in §31.4.

---

# Part I — Identity, Boundaries, and Product

---

## 1. What DevDesk Is

**DevDesk is a desktop experience platform for Windows: a native host that lets a person compose their own desktop out of surfaces, themes, and layouts, without modifying the operating system.**

Three parts of that sentence carry weight.

**"Desktop experience platform."** DevDesk is not an application that displays widgets. It is a runtime, an extension model, and a set of contracts on which desktop experiences are built — by us and by other people. The first-party surfaces that ship with it are reference implementations of the plugin contract, not the product. If DevDesk succeeds, most of what runs on it will be things we did not write.

**"Compose their own desktop."** The unit of value is not any individual surface. It is the arrangement — what sits where, on which monitor, in which layer, under which theme, in which layout. A clock is a commodity. A desktop that is *yours*, that survives a reboot and a dock cycle and a monitor swap, is not.

**"Without modifying the operating system."** DevDesk composes on top of Windows. It does not patch the shell, replace Explorer, inject into system processes, or write to system-wide registry keys to achieve its effects. This is a permanent constraint (§3, §12.3), not a v1 limitation, and it is the single largest differentiator from the tools this project was born out of frustration with.

DevDesk consists of these subsystems, each with an owning specification:

| Subsystem | What It Provides | In V1 |
| --- | --- | --- |
| **Desktop Runtime** | The native host process: window lifecycle, layers, display topology, state, persistence | **Yes** |
| **Theme Engine** | The token pipeline that makes every visual value declarative and swappable | **Yes** |
| **Widget Runtime** | Surface lifecycle, drag, resize, isolation | **Yes** |
| **Layout Engine** | Placement across monitors, anchoring, topology-aware arrangement | **Yes** |
| **Plugin System** | The capability-gated extension model everything on the platform runs through | **Yes** |
| **Plugin SDK** | The public, versioned contract third-party authors build against | **Yes** |
| **Studio** | Authoring environment for surfaces, themes, and layouts | No — §26 H4 |
| **Marketplace** | Signed distribution and discovery | No — §26 H5 |

---

## 2. What DevDesk Is Not

These are **hard boundaries**, not preferences. A proposal that requires crossing one is not a feature request; it is a request to build a different product.

**DevDesk is not a Rainmeter clone.** This is the most important entry in this section, because Rainmeter is where the project started (§5) and therefore the easiest thing to accidentally rebuild. Rainmeter's model — INI configuration, per-skin scripting, no capability boundary, no layout engine, no theming layer, no notion of a topology — is precisely what DevDesk exists to replace. We are not looking for feature parity with it. We are looking for the thing a person actually wanted when they installed it.

**DevDesk is not a Wallpaper Engine clone.** Animated wallpaper is a possible surface type on a possible layer. It is not the product, not the identity, and not a priority.

**DevDesk is not a Windows shell replacement.** It does not replace Explorer, the taskbar, the Start menu, or the window manager. It composes alongside them. A user who uninstalls DevDesk gets their unmodified desktop back, immediately, with no repair step.

**DevDesk is not a widget application.** There is no fixed catalogue of first-party widgets that constitutes the product. If a first-party surface needs something the plugin contract cannot express, the contract is deficient and gets fixed — for everybody. There is no internal shortcut.

**DevDesk is not a web application shipped in a shell.** No remote-hosted UI, no runtime code download, no network dependency on any path that has to work.

**DevDesk is not a general-purpose scripting host.** Extensions run in a capability-gated sandbox with a declared, auditable permission set. "Run arbitrary code on my desktop" is not a supported extension mechanism.

**DevDesk is not a system optimizer, cleaner, tweaker, or debloater.** It does not touch system settings to make itself work, and it never will (§12.3).

**DevDesk is not a server, a service, or a multi-user product.** It is single-user, local-first, and offline-capable. Sync, if it ever exists, is an opt-in plugin across an explicit boundary.

---

## 3. Product Boundaries — What DevDesk Owns

§2 says what DevDesk is not. This section says what it is *responsible for*, which is the more useful question during design. **A feature that requires DevDesk to take ownership of something in the right-hand column is out of scope by definition**, regardless of how convenient it would be.

### 3.1 The Ownership Split

| DevDesk **owns** | DevDesk **does not own** |
| --- | --- |
| **Customization** — how a desktop is shaped, configured, and personalized | **File management** — browsing, moving, opening, or organizing files |
| **Presentation** — how surfaces look, layer, blur, animate, and compose | **Process management** — starting, stopping, monitoring, or prioritizing processes |
| **Layout** — where surfaces sit across monitors, anchors, z-order, topology persistence | **Window management** — the placement, tiling, focus, or z-order of *application* windows |
| **Theming** — the token system, cascade, switching, accessibility overrides | **Shell replacement** — Explorer, taskbar, Start menu, notification centre |
| **Widgets and surfaces** — their lifecycle, isolation, and runtime | **System security** — hardening, scanning, firewalling, or protecting the machine |
| **The extension contract** — the SDK, capability model, and plugin supervision | **Package management** — installing, updating, or managing software on the machine |
| **Its own persistence** — layouts, grants, preferences, plugin state | **System settings** — display configuration, power plans, drivers, OS preferences |

### 3.2 Two Distinctions That Are Easy to Get Wrong

Both of these look like contradictions with other sections. Neither is, and stating them precisely now prevents a bad argument later.

**"Does not own window management" — but DevDesk places windows.** DevDesk manages **only its own surfaces**: their monitor, layer, anchor, size, and z-order. It never moves, resizes, tiles, focuses, or reorders the user's *application* windows, and it never becomes the thing that decides where Chrome opens. If a feature would require DevDesk to arbitrate over windows it does not own, that feature is a window manager, and DevDesk is not one (§2).

**"Does not own system security" — but DevDesk has a rigorous security model.** DevDesk owns the security of **its own extension boundary** absolutely (§19): what a plugin may reach, what the user granted, what crosses the trust boundary. It owns **no responsibility for the machine's security posture** — it is not antivirus, not a firewall, not a hardening tool, and it never presents itself as protecting the user from anything other than DevDesk's own extensions.

### 3.3 Where Contested Capability Goes

Some genuinely useful things sit on the far side of the line — a file-browser surface, a process monitor, a launcher. **These are not forbidden; they are not core.** They belong in plugins, built on the same public contract as any third-party extension, holding narrowly-scoped capabilities the user granted explicitly.

This is the mechanism that keeps the boundary honest. The question is never "should DevDesk be able to do this?" It is **"can a plugin do this within the contract?"** — and if the answer is no, the finding is about the contract, not about the core's scope.

---

## 4. Non-Goals

Beyond §2 and §3, these are deliberately **not** being built, and designing for them is out of contract.

1. **A fixed catalogue of first-party widgets as the product.**
2. **Feature parity with any existing tool.** Compatibility importers, if ever built, are plugins and never core — the core must not acquire format-specific knowledge.
3. **Arbitrary native code execution as an extension mechanism.**
4. **Server-side, multi-user, or fleet-managed operation.**
5. **Cross-machine sync in the core.** If it ever exists it is an opt-in plugin across an explicit boundary. The seam is kept open today by a real constraint: no syncable record may contain a machine-local path.
6. **Any network dependency on a path that has to work.** DevDesk is fully functional offline, permanently.
7. **Mobile, web, or tablet targets.** DevDesk is a desktop product.
8. **Being a system utility.** No cleaning, tweaking, debloating, or optimizing.

---

## 5. Origin — The Problem That Produced DevDesk

DevDesk did not begin as a product idea. It began as a person trying to make their desktop look and work the way they wanted, and failing — not because the tools were missing, but because the tools were built on assumptions that break the moment a setup gets slightly real.

The concrete sequence: a laptop driving an external high-refresh monitor. Widgets assembled in Rainmeter — a clock, the date, system specifications, weather, a music player. Then the problems, in roughly this order:

- **The widgets did not compose.** Each one came from a different author with a different visual language. Making them look like one system meant editing each one by hand, and there was no shared notion of colour, spacing, radius, or motion to edit *toward*.
- **Configuration was archaeology.** Getting a weather widget to work meant finding out which numeric code to paste where. Getting a music player to look right meant accepting whatever "odd kinda player" the skin produced. The gap between "I want this" and "here is where you type it" was enormous.
- **Multi-monitor was broken.** Surfaces landed on the wrong display. The laptop panel and the external monitor disagreed. Selecting a target desktop did not make things behave. Content was cut off at screen edges.
- **Hiding, moving, and arranging things was fiddly** in a way that made the desktop feel fragile rather than owned.

None of these are exotic. They are what happens on a completely ordinary setup — one laptop, one external monitor, five widgets. **That is the observation DevDesk is built on:** the existing tools are not failing at their hard cases, they are failing at their easy ones, because they were designed for a single monitor at a single scale factor with no shared visual system and no isolation between extensions.

This origin is the reason several architectural commitments are non-negotiable rather than nice-to-have:

| Origin Frustration | Permanent Commitment |
| --- | --- |
| Widgets that don't compose visually | **Theme-first**: every visual value is a token, and one theme restyles everything (§11.1) |
| Configuration as archaeology | **Direct manipulation first**: the primary interface is the desktop itself, not a config file (§10.1) |
| Multi-monitor breakage | **Topology-aware by construction**: layout is stored per monitor arrangement and survives dock cycles (§13) |
| Content cut off, wrong scale | **Mixed-DPI correctness as a first-class concern**, tested on mixed-DPI hardware by default (§13) |
| Third-party skins with unbounded reach | **Capability-gated plugins**: extensions get exactly what the user grants (§19) |

**Every engineer and agent should treat §5 as the acceptance test.** If a design would not have solved these five problems for the person who had them, it is not aligned with the project, however elegant it is.

---

## 6. The Long-Term Vision

### 6.1 The Vision Statement

**A desktop you can shape as completely as a Linux rice, that runs and feels like it was built by the people who made the operating system.**

Today the person who wants a deeply personal desktop has two options, and both cost something they should not have to pay:

- **Move to Linux**, where the desktop environment is genuinely composable — but leave behind the hardware support, the software, the games, and the vendor tooling that keeps them on Windows.
- **Stay on Windows and layer on third-party tools**, accepting fragility, visual incoherence, per-tool configuration formats, no isolation between extensions, and a desktop that breaks when a monitor is unplugged.

DevDesk exists to remove that trade. The long-term goal is that a person on Windows can build a desktop as specific and as personal as anything in the Linux ricing community, and have it be **stable, fast, coherent, safe, and recoverable** — properties Windows software is expected to have and desktop customization software usually is not.

Beyond one machine, the vision is an **ecosystem**: theme authors who never write code, surface authors who write against one stable contract, a signed distribution channel, an authoring environment, and eventually the same platform on macOS and Linux — where DevDesk becomes not an escape from Windows' rigidity but a consistent way to own your desktop wherever you work.

### 6.2 What the Vision Commits To, Numerically

"Stable, fast, coherent" is not a commitment. These are. Each cites its owning budget in [`ADR-0002`](docs/adr/ADR-0002-performance-budgets.md) per the §0.4 rule; **the budget is authoritative, this table is a reference**.

The workload for every figure below is ADR-0002's **W2 reference workload** — 12 surfaces, 3 monitors of mixed DPI and mixed refresh, 8 active plugins, full glass — on its reference machine, a mid-range 2020-class laptop with integrated graphics. That is deliberate: the vision is measured against a real setup, not a demo.

| Vision commitment | Target | Budget | Status |
| --- | --- | --- | --- |
| **Your desktop is ready in about a second, not "eventually"** | First pixel ≤ 800 ms; fully ready with all content ≤ 2 s | `PB-S1`, `PB-S3` | Prototype-gated |
| **It does not eat your machine** | ≤ 320 MB total; ≤ 150 MB in Safe Mode | `PB-M3`, `PB-M4` | Derived from prototype-gated inputs |
| **You cannot feel it running when it is idle** | ≤ 1.0% of one core; zero repaints over 60 s idle | `PB-C1`, `PB-R3` | Derived |
| **Dragging a surface is as smooth as your monitor allows** | Frame budget = your display's actual refresh interval, never worse than 60 fps | `PB-R1`, `PB-R2` | Prototype-gated |
| **Changing theme is instant, not a reload** | Entire desktop restyled ≤ 120 ms | `PB-R4` | Provisional |
| **Adding a widget is immediate** | Plugin cold activation ≤ 250 ms | `PB-P1` | Provisional |
| **Plugging in a monitor just works** | Layout reapplied and repainted ≤ 400 ms after the change settles | `PB-G7` | Provisional |
| **Installing plugins never makes startup slower** | 20 installed, non-activated plugins add **0 ms** to startup | `PB-P9` | Derived — structural, not a tolerance |
| **Quitting is instant** | Process exit ≤ 400 ms in the normal case | `PB-D1` | Provisional |

**Read the Status column honestly.** No line here has been measured — no DevDesk code has run. Each is an engineering estimate with a named validating experiment in ADR-0002 §12, and several will move. **A figure moving because a spike disproved it is the system working**; a figure moving because it was inconvenient is not, and ADR-0002 §13.2 is what distinguishes them.

The non-numeric commitments are in §27 (Success Metrics), and `S-3` — *zero reports of a silently lost arrangement* — is the one with no acceptable nonzero value.

---

## 7. V1 Scope

The single most effective defence against scope creep is a written, agreed list of what is **not** in the first release. This section is that list. Both halves are binding.

### 7.1 V1 Must Have

V1 is complete when a person can build, own, and keep a real desktop on Windows.

| # | Capability | Why It Is Non-Negotiable |
| --- | --- | --- |
| **V1-1** | **Desktop Runtime** — host process, window lifecycle, surface layers, display topology, state ownership | Nothing else exists without it |
| **V1-2** | **Theme Engine** — token pipeline, cascade, live switching, accessibility overrides | §5's first frustration; without it DevDesk is another incoherent skin collection |
| **V1-3** | **Widget Runtime** — surface lifecycle, drag, resize, per-surface isolation | The everyday customization loop (§11.3) |
| **V1-4** | **Layout Engine + layout persistence** — anchors, z-order, placement policy | The unit of value is the arrangement (§1) |
| **V1-5** | **Multi-monitor layouts** — per-topology persistence, mixed DPI, mixed refresh, dock/undock survival | §5's central frustration; the primary differentiator (§13) |
| **V1-6** | **Settings** — surface configuration, theme selection, granted capabilities, effective-config provenance | A user must be able to see and change what is happening (§27 S-4) |
| **V1-7** | **Plugin loading** — manifest validation, sandbox, capability grants, revocation, supervision | The extension model everything runs on (§11.4) |
| **V1-8** | **Public Plugin SDK v1** — the versioned contract third parties build against | Without it DevDesk is an app, not a platform (§1) |
| **V1-9** | **Glass and effects with observable degradation** | The visual signature (§15.1), and it must degrade honestly rather than silently |
| **V1-10** | **Safe Mode and crash recovery** | Deep customization is only safe to attempt if the cost of a bad experiment is bounded (§10.5) |
| **V1-11** | **Keyboard operability of every core action** | §12; also the precondition for automation later |
| **V1-12** | **Windows GA quality** — installer, updater, uninstall that leaves no trace | §12.3 |

### 7.2 V1 Will Not Include

Each of these is a real ambition (§26) and explicitly out of the first release.

| # | Excluded | Why Not V1 |
| --- | --- | --- |
| **X-1** | **Marketplace** | Requires signing infrastructure, moderation, and update channels. The *trust primitives* it needs — bundle signing, capability declaration — ship in V1 because they cannot be retrofitted onto an installed base; the marketplace itself cannot. |
| **X-2** | **Cloud / cross-machine sync** | Contradicts the local-first posture (§2) until it can be an opt-in plugin over an explicit boundary. The seam is kept open in V1 by one binding constraint: no syncable record contains a machine-local path. |
| **X-3** | **Mobile companion app** | DevDesk is a desktop product (§4). A companion app implies a network service, which contradicts §19.3. |
| **X-4** | **AI theme generation** | Depends on a mature, stable token system to generate *into*. Building it against a token system still in flux would freeze the token system prematurely — and it needs network egress, which §19.3 forbids without explicit per-action consent. |
| **X-5** | **Community sharing and social discovery** | A distribution problem, and it depends on X-1. |
| **X-6** | **Studio authoring application** | Widens the audience to §8.3, but requires the contracts it authors *against* to be stable first. |
| **X-7** | **macOS and Linux general availability** | They remain **first-class targets**: the platform abstraction is maintained, code compiles, and platform gaps report themselves. They are not *shipped* in V1. |
| **X-8** | **Automation / scripting API** | The architectural precondition — every user-reachable action expressible as a command — is enforced in V1 (V1-11). The public API is not exposed. |
| **X-9** | **WASM plugin runtime** | Stronger isolation than V1's sandbox, immature authoring ergonomics. The seam stays open via a binding V1 constraint: the host API remains flat, serializable, and capability-scoped. |
| **X-10** | **Compatibility importers** (Rainmeter skins and similar) | Would require the core to learn a foreign format, which §3 forbids. If ever built, a plugin. |

### 7.3 Open Scope Questions

Two items are genuinely undecided. They are listed rather than silently assumed, and each needs a decision before its stage.

| # | Question | Impact | Decide By |
| --- | --- | --- | --- |
| **Q-1** | **Does the wallpaper layer ship in V1?** It is the most visually striking capability and the least portable — the Linux compositor situation has no universal answer. | Feature scope; the cross-platform story | Before the window subsystem is built (tracked as `OQ-5`) |
| **Q-2** | **Does V1 include a command palette, or only keyboard shortcuts and navigation?** V1-11 commits to every core action being keyboard-reachable. A palette is a distinct, larger surface. | Scope of V1-11 and V1-6 | Before the shell is specified |

### 7.4 Definition of "V1 Is Done"

V1 ships when **all four** hold — not when the V1-1…V1-12 checklist is ticked:

1. **All five origin frustrations in §5 are solved** for the setup that produced them.
2. **A third-party author can ship a working surface** using only public documentation, with no privileged access.
3. **Every V1 budget in §6.2 is measured on the reference machine and met** — or has an accepted, recorded amendment explaining why the estimate was wrong.
4. **A user can uninstall DevDesk and get their original desktop back**, with no repair step.

---

## 8. Target Users

DevDesk is built for a specific person first, and widens outward from there. Building for everyone immediately would produce something that serves the origin user (§5) badly.

### 8.1 Primary — The Customizer

Someone who has already tried to personalize their desktop and hit the wall. They have used Rainmeter, or run a Linux rig, or spent a weekend on a setup that broke. They are technically confident but they are **not** looking for a programming project — they want direct manipulation, sane defaults, and depth available when they reach for it.

This user is the product's centre of gravity. When a design decision is contested, ask what this person would do, and optimize for that.

### 8.2 Primary — The Developer and Power User

Someone who lives on their machine for eight hours and wants that environment to carry information and controls at a glance — system state, project state, media, time, whatever matters to them. They will happily write a surface if the contract is good, and they will judge the SDK harshly and correctly.

This user is why the platform must be **contract-first and genuinely extensible**, not merely configurable.

### 8.3 Secondary — The Author

Theme authors and surface authors who build for other people. They are a secondary audience today and the **primary audience of the platform's long-term success** — the ecosystem is the product's ceiling. Every decision that makes authoring easier, safer, or more discoverable compounds.

### 8.4 Explicitly Not Targeted

Enterprise fleet deployment, kiosk and digital-signage use, and users who want a single-click preset with no customization at all. None of these are wrong; they are simply not what the architecture is shaped for, and pursuing them early would compromise it.

---

## 9. Competitive Positioning

DevDesk is not competing on feature count with any of the tools below. It is competing on **a different set of guarantees**.

| | Rainmeter | Wallpaper Engine | Windows Widgets | Linux DEs / ricing | **DevDesk** |
| --- | --- | --- | --- | --- | --- |
| Depth of customization | High | Low (wallpaper only) | Very low | Very high | **Very high** |
| Visual coherence across extensions | None | N/A | Enforced, unchangeable | Achievable with effort | **Enforced and fully themeable** |
| Multi-monitor and mixed-DPI correctness | Poor | Moderate | Moderate | Varies by compositor | **First-class, tested by default** |
| Extension isolation and permissions | None | N/A | Sandboxed, closed | Varies | **Capability-gated, user-granted, revocable** |
| Modifies the OS | No, but reaches deeply | No | Is the OS | Is the OS | **No, by permanent commitment** |
| Extension model | INI skins + Lua | Closed | Closed | Per-DE | **Public, versioned, contract-first SDK** |
| Recovery when something breaks | Manual | N/A | N/A | Varies | **Safe Mode, always reachable** |
| Available on Windows | Yes | Yes | Yes | **No** | **Yes** |

**The positioning in one line:** *the flexibility people move to Linux for, with the stability and performance people stay on Windows for.*

**How to use this table.** It is a statement of what DevDesk must be good at, not a checklist to beat. Reproducing a competitor's feature is never a justification on its own; the architecture explicitly rejects feature-parity mandates. The correct question is always whether a capability serves §5, §6, and §10.

---

## 10. Product Philosophy

*How DevDesk behaves toward the person using it.*

### 10.1 The Desktop Is the Interface

The primary way a user changes their desktop is **by manipulating the desktop**. Drag a surface, it moves. Drag its edge, it resizes. Right-click it, its options are there. Settings panels exist for things that genuinely have no spatial representation — they are not the main path.

This is the direct answer to §5's "configuration as archaeology." A config file is a fallback for power users and a recovery mechanism (§25.1), never the primary interface.

### 10.2 Sane Defaults, Infinite Depth

DevDesk must be beautiful and useful **before the user changes anything**, and must not have a floor on how far they can take it. These are not in tension if the defaults are opinionated and every default is a token or a setting rather than a hardcoded value.

A user who never opens settings should have a desktop they like. A user who spends a weekend should be able to build something unrecognizable.

### 10.3 Nothing Is Ever Silently Lost

This is the trust commitment, and it is absolute.

A user's layout is their work. Unplugging a monitor, docking a laptop, changing resolution, updating DevDesk, a plugin crashing, a theme failing to parse — **none of these may silently destroy an arrangement.** Where DevDesk cannot restore something automatically, it says so, explains why, and offers one-click recovery. Where a config file is unparseable, the previous good copy is used and the bad one is preserved for inspection.

A customization tool that loses your setup once has lost the user permanently, and it deserves to.

### 10.4 Failure Is Visible, Local, and Explicable

When something breaks, three things must hold: the failure stays inside the thing that failed, the user can see that it failed, and the message says what broke, why, and what to do next.

A blank region, a silently missing feature, or "an error occurred" are all failures of this principle. So is a surface degrading its visual quality without saying so — silent degradation produces "it looks different on my machine" reports that nobody can reproduce.

### 10.5 The Escape Hatch Always Exists

A user can always get back to a working desktop. Safe Mode — default theme, no plugins, minimal surfaces — is reachable automatically after repeated failures and manually on demand. This is what makes deep customization safe to attempt: the cost of a bad experiment is bounded.

### 10.6 It Must Feel Native

Not "web app in a window." Not "custom-drawn everything." Motion, latency, focus behaviour, and input handling must feel like software that belongs on the operating system it is running on. A 4 ms delay on a drag is the difference between a tool and a toy, and users perceive it without being able to name it.

---

## 11. Customization Philosophy

DevDesk offers four distinct customization surfaces. They are deliberately separated by **what they require of the user**, so that a person can go as deep as they want and no deeper.

### 11.1 Themes — Zero Code

A theme is a set of token values. It restyles the entire desktop — first-party and third-party surfaces alike — without a single line of code and without reloading anything.

**A theme is data. A theme is never code.** No JavaScript, no WASM, no scripting hooks, no expression language with side effects. This is a security invariant before it is an architectural one: themes are the lowest-friction thing anyone will ever install, which makes them the highest-value attack surface on the platform. A theme install must never be able to become code execution.

The cost is real and accepted: some genuinely dynamic theming requires a plugin. That is the correct trade, because the plugin path is capability-gated and visible to the user, and the theme path is neither.

### 11.2 Layouts — Direct Manipulation

A layout is where surfaces sit: which monitor, which layer, which anchor, what size, what z-order. Built by dragging (§10.1), stored per monitor arrangement (§13), switchable as a set.

Anchored placement — relative to a screen edge or corner — is the **default**, because it survives resolution changes and DPI changes. Absolute placement is available and is the thing that breaks when the display changes, which is why it is not the default.

### 11.3 Widgets and Surfaces — Assembly

A user adds a surface, positions it, sizes it, configures it, themes it. This is the everyday customization loop and it must be fast, forgiving, and reversible.

### 11.4 Plugins — Full Extension

A plugin adds new surface types and new capabilities. It is written against a public, versioned SDK; it declares what it needs; the user grants or refuses; the grant is revocable at any time without a restart.

**First-party surfaces are built on this same contract with no privileged path.** This is a foundational commitment, and it is expensive on purpose: early first-party development is slower because contract gaps must be *fixed* rather than routed around. That cost is what keeps third-party authors first-class citizens permanently, and it is what makes the contract's deficiencies visible while they are still cheap to correct.

---

## 12. What "Linux Flexibility" Means Here

The phrase *"flexibility like Linux"* is load-bearing in this project's vision and **dangerous if left undefined** — it sets an expectation nobody can satisfy, and invites a scope argument every time someone names a Linux capability DevDesk does not have.

This section defines it exactly. **The five commitments below are the whole of it.** A capability not on this list is not implied by "Linux flexibility" and does not inherit its authority.

### 12.1 What It Means — The Five Commitments

| # | Commitment | Concretely |
| --- | --- | --- |
| **F-1** | **Movable panels and surfaces** | Any surface can be placed on any monitor, in any supported layer, anchored to any edge or corner, at any size — by direct manipulation, not configuration |
| **F-2** | **Multiple named layouts** | A user defines several complete arrangements and switches between them; each is bound to a monitor topology and restored on return to it |
| **F-3** | **A theme token system** | Every visual value in the system is a token. One theme restyles everything including third-party surfaces, with no code and no reload |
| **F-4** | **An extensible plugin model** | New surface types and capabilities are added by third parties against a public, versioned contract — not by forking, patching, or scripting into the core |
| **F-5** | **Keyboard-driven workflows** | Every user-reachable action is operable from the keyboard. This is enforced structurally: **an action that cannot be expressed as a command does not ship**, because UI-only paths are exactly what makes automation impossible to add later |

### 12.2 What It Does Not Mean

Stated as plainly as the commitments, because this half is what prevents the scope argument.

| It does **not** mean | Why |
| --- | --- |
| Replacing the window manager or compositor | §3 — DevDesk composes alongside the OS, it does not become it |
| Swapping out DevDesk's own subsystems | Linux's replaceability is also its fragility. DevDesk is **one runtime with one contract** (§9), deliberately |
| Scripting as a configuration language | §11.1 — themes are data; the extension path is the plugin contract, not an embedded interpreter |
| Recompiling, patching, or editing source to customize | Everything customizable is customizable at runtime, by a non-programmer (§10.2) |
| Editing config files as the primary workflow | §10.1 — config is a fallback and a recovery path, never the main road |
| Feature parity with any specific desktop environment | §4 non-goal 2. Ideas are taken; catalogues are not |
| Unrestricted access to the system for extensions | §19 — Linux's permission model is not the part worth copying |

### 12.3 What "Windows-Native" Means Concretely

The other half of the positioning, and equally in need of definition.

- **The OS provides the primitives.** Window layering, click-through, DPI, transparency, and compositing use platform mechanisms rather than being simulated.
- **Native performance characteristics.** Startup, idle cost, and interaction latency are those of a desktop application, not a web page — quantified in §6.2.
- **No OS modification.** No shell replacement, no process injection, no system-wide registry tampering. Uninstalling restores the machine, immediately.
- **Windows conventions are respected.** Autostart, file locations, per-monitor DPI, power and battery states, and system theme and accent behave the way Windows applications are expected to behave.
- **The OS's own signals are honoured.** Battery saver, low-power mode, and accessibility preferences change DevDesk's behaviour without being asked twice.

### 12.4 Windows First, Not Windows Only

Windows is the primary target because it is where the problem is worst and where the user is. macOS and Linux are **first-class targets**, not eventual ports — though they do not reach general availability in V1 (§7.2, X-7).

The practical commitment: the platform abstraction is written **before** the Windows-specific work, not retrofitted after. A capability unavailable on a platform reports itself as unavailable with a reason — it never silently does nothing, because a silent no-op produces a bug that reproduces only on the operating system nobody on the team uses.

---

## 13. Multi-Monitor Philosophy

Multi-monitor is not an advanced feature of DevDesk. It is **the baseline case**, and it is where the tools in §5 failed most visibly.

**Monitors have identity, not positions in a list.** A monitor is identified by something stable about the monitor itself, never by its index in an enumeration — indices reorder across reboots and dock events, and every layout bound to one silently relocates.

**Layout belongs to an arrangement, not to a machine.** A user's docked three-monitor setup and their undocked laptop are different arrangements with different layouts. Moving between them restores what the user configured for each. This is the common case — laptop plus dock — not an edge case.

**An unknown arrangement resolves predictably, never destructively.** Plug into an unfamiliar setup and surfaces land somewhere sensible with anchors preserved, and the user is offered one-click restore. Nothing is lost (§10.3).

**Mixed DPI is assumed.** A 4K display at 150% next to a 1080p display at 100% is a normal configuration, not a stress test. It is the default test configuration precisely because scale confusion is the largest defect class in this kind of software and it is invisible on a uniform setup.

**Mixed refresh is assumed.** A 144 Hz panel next to a 60 Hz panel means smoothness is defined relative to each display's actual refresh rate. Sixty frames per second is a floor, not a target — this is directly traceable to §5's origin hardware.

**Displays lie about themselves, briefly.** Hotplug notifications are treated as hints that something changed, never as truth about what it changed to. The system re-asks the OS for the real arrangement.

---

## 14. Product Principles

| # | Principle | What It Rules Out |
| --- | --- | --- |
| **P-1** | The user's arrangement is their work and is never silently lost | Any change that can destroy a layout without a recovery path |
| **P-2** | The desktop is the primary interface; configuration is the fallback | Features reachable only by editing a file |
| **P-3** | Beautiful before configuration; unbounded after | Both an ugly default and a customization ceiling |
| **P-4** | Every visual value is a token | Any hardcoded colour, radius, blur, shadow, or duration, anywhere |
| **P-5** | Multi-monitor and mixed-DPI are the baseline case | Anything correct only on a single uniform display |
| **P-6** | Extensions are capability-gated and revocable | Ambient access of any kind, for any extension, first-party included |
| **P-7** | First-party has no privileged path | Internal shortcuts around the plugin contract |
| **P-8** | Nothing leaves the machine without explicit per-action consent | Telemetry, analytics, crash upload, background sync |
| **P-9** | Failure is visible, local, and explicable | Blank regions, silent no-ops, silent quality degradation, "an error occurred" |
| **P-10** | There is always a way back to a working desktop | Any state a user cannot escape without reinstalling |
| **P-11** | DevDesk never modifies the operating system to achieve an effect | Shell replacement, process injection, system-wide registry tampering |
| **P-12** | Idle costs approximately nothing | Polling, unbounded timers, work produced for nobody |
| **P-13** | Every user-reachable action is expressible as a command | UI-only paths with no programmatic equivalent |

---

# Part II — Design

---

## 15. Design Philosophy

### 15.1 Glassmorphism Is the Signature — And It Is Governed

DevDesk's visual identity is **depth**: translucent surfaces, real blur, considered shadow, layered composition. This is a deliberate aesthetic commitment, and it is what makes a DevDesk desktop recognizable.

It is also the most expensive thing the platform renders, so it is **budgeted rather than free**. Glass goes through one owning subsystem that accounts for its cost and degrades it in a defined order when hardware cannot sustain it — and that degradation is visible to the developer rather than silent (§10.4).

The design consequence: **glass is an effect the system grants, never one a component or a plugin applies for itself.** An author asks for a glass surface; they do not specify a blur radius.

### 15.2 Minimal Chrome, Maximum Content

Surfaces are content with as little frame as possible. Controls appear on hover or interaction and get out of the way otherwise. The desktop is the user's — DevDesk's job is to be invisible while their content is not.

### 15.3 Motion Is Meaning

Animation communicates causality — where something came from, what it became, what is loading. Decorative motion that communicates nothing is removed. Motion must be smooth at the display's actual refresh rate (§6.2), and it must respect the user's reduced-motion preference **unconditionally**: a theme cannot opt out of an accessibility preference, ever.

### 15.4 One Visual System

Every visual value in DevDesk — colour, spacing, radius, blur, shadow, duration, easing — is a **token**. Nothing is hardcoded anywhere, including in first-party components and third-party plugins.

This is the direct architectural answer to §5's "widgets that don't compose." When every value is a token, one theme restyles the entire desktop including third-party surfaces, and visual coherence stops being something authors have to coordinate on.

### 15.5 Accessibility Is Not a Theme Setting

Reduced motion, reduced transparency, high contrast, and increased contrast are **system preferences that override theme values unconditionally**. A beautiful theme that is unreadable in high-contrast mode is a broken theme. This is enforced in the token resolver, not left to author discipline.

---

## 16. Design Principles

| # | Principle |
| --- | --- |
| **D-1** | Depth over decoration — translucency, blur, and shadow express layering, not ornament |
| **D-2** | Content over chrome — controls appear on demand and recede otherwise |
| **D-3** | Motion communicates causality; motion that communicates nothing is removed |
| **D-4** | One visual system — every value is a token, including inside third-party surfaces |
| **D-5** | Accessibility preferences override themes unconditionally; a theme cannot opt out |
| **D-6** | Glass is granted by the system, never applied by a component or a plugin |
| **D-7** | Smoothness is defined relative to each display's actual refresh rate |
| **D-8** | Themes carry visual identity; engines carry no visual opinions |
| **D-9** | Surfaces are visually isolated — no surface can style, read, or reach into another |
| **D-10** | Every state has a designed appearance: loading, empty, degraded, denied, and failed |

---

# Part III — Engineering

---

## 17. Engineering Philosophy

The binding technical decisions live in [`SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md) and the ADR register. This section states the reasoning, so that a future engineer can tell which parts are load-bearing.

### 17.1 Rust Core, React Shell, Tauri Runtime

**Rust owns everything native and everything authoritative.** State, display topology, storage, plugin supervision, and — critically — every authorization decision. Rust was chosen because a persistent, always-running process holding a capability boundary is exactly the workload where memory safety and explicit error handling stop being preferences.

**React and TypeScript own presentation.** Composition, rendering, interaction. The shell holds a projection of state and never an authority over it.

**Tauri is the runtime** because it uses the OS's own webview rather than bundling a browser, which is what makes the memory and startup profile in §6.2 achievable at all.

**React never talks to the operating system.** Every native capability crosses a typed boundary into Rust. This is not layering ceremony — it is what makes the security model in §19 possible, because a boundary that can be bypassed is not a boundary.

### 17.2 Contracts First

The boundary between Rust and TypeScript is the most important contract in the system. It is **generated from the Rust definitions, never hand-written on both sides**, because a hand-maintained mirror drifts silently, and silent drift at a trust boundary is a security problem rather than a typing inconvenience.

The contract is versioned **independently of the application**, so that a plugin written a year ago either works or refuses to load with a precise diagnostic — never loads and corrupts something.

### 17.3 One Source of Truth for State

All durable and shared state lives in the Rust core. The shell holds a projection.

The reasoning is about scale, not purity: with a dozen surfaces across three monitors plus plugin observers, two authorities produce divergence bugs that grow quadratically in observer pairs and reproduce only under specific timing. Single ownership does not make that class of bug rare; it makes it impossible.

The cost — every mutation is a round trip, and direct manipulation needs an optimistic-update protocol — is accepted deliberately: bounded complexity in one place instead of unbounded divergence everywhere.

### 17.4 Extension Is the Default Mechanism

Adding a capability should mean adding a plugin, a theme, a surface type, or a token — not modifying the core. The core stays small and stable; the ecosystem grows around it. Where the core must change to enable an extension, the change is generic and never format-specific or plugin-specific.

### 17.5 Documentation Drives Implementation

Specification precedes code. This is not a process preference; it is a consequence of §17.4. Contracts that third parties build against become permanent obligations the moment they ship, and the cost of deciding one badly under implementation pressure is measured in years.

Order: **Research → Specification → Architecture review → ADR → Implementation → Tests → Benchmark → Documentation update.**

---

## 18. Performance Philosophy

**Performance is a feature, and on this product it is a correctness property.** DevDesk runs continuously, all day, on machines doing other work. Software like that is not judged on peak throughput; it is judged on whether the machine feels the same with it running.

### 18.1 The Cost of Doing Nothing Is the Real Cost

The dominant cost of a persistent desktop application is idle cost multiplied by all day. An idle desktop should be approximately free: no polling, no repaints, no timers that scale with the number of surfaces, no work produced for state nobody is looking at.

This drives real architecture. State is pushed rather than polled. Surfaces subscribe only to what they render and stop when they unmount. Occluded and off-screen surfaces suspend entirely. Timers coalesce into one scheduler — twelve surfaces with a one-second tick produce one wakeup per second, not twelve.

### 18.2 Eliminate Work Before Optimizing It

Making a component that should not have re-rendered cheaper to re-render is not a fix. Not re-rendering it is.

### 18.3 The Frame Budget Belongs to the User

The webview main thread is the scarcest resource in the system. Any decision that moves work off it is worth real complexity; any decision that adds to it needs justification. Dragging a surface must be smooth at the display's real refresh rate, which means the operating system moves the window and no round trip happens per frame.

### 18.4 Budgets Are Gates, Not Goals

An unenforced performance target is a preference. Every budget has a defined workload, a defined metric, a measurement method, and a CI gate — and where a budget cannot yet be honestly measured, it is marked as such rather than pretending. The headline commitments are in §6.2; the numbers, reference machine, workloads, and measurement methodology are owned entirely by [`ADR-0002`](docs/adr/ADR-0002-performance-budgets.md).

### 18.5 Degrade Visibly, Never Silently

When hardware cannot sustain full visual quality, DevDesk reduces quality in a defined order and **says so** to anyone looking. Silent degradation produces unreproducible reports and is treated as a defect (§10.4).

---

## 19. Security and Trust Philosophy

### 19.1 The Threat Is Structural, Not Hypothetical

DevDesk runs continuously, with the user's full privileges, executing third-party bundles that people install casually because it is "just a theme" or "just a widget." High privilege, low install friction, permanent execution — that combination *is* the security problem, and it is why the permission model is foundational infrastructure rather than a later hardening pass.

### 19.2 Capabilities, Granted by the User, Revocable at Any Time

An extension declares what it needs and why, in plain language. The user sees that reason verbatim and decides. Grants are as narrow as possible — a capability names a folder, never a drive. Grants persist, are listed, and can be revoked instantly without a restart.

**There is exactly one place in the system where authorization is decided, and it is in Rust.** Checks in the UI are conveniences; they are not security. An extension's identity is established by the host, never accepted from the extension's own claim.

### 19.3 Nothing Leaves the Machine

**No telemetry. No analytics. No crash-report upload. No background network activity of any kind.**

This is not a privacy feature to be balanced against product-development convenience. It is the trust posture the product requires: DevDesk asks a person to let it run permanently with full privileges over their desktop, and the honest exchange for that is that it does not phone home.

The cost is genuine — field diagnostics rely entirely on user-initiated local reports, so the local diagnostic tooling has to be unusually good, and the observability design compensates on purpose.

Plugin network access is per-extension, per-destination, granted, and permanently visible. A user can always answer *"what is talking to the network, and to where?"*

### 19.4 The Core Never Trusts Anything From Outside Itself

Manifests, themes, config files, and messages from the UI all originate outside the trusted boundary. All of them are validated into known-good shapes at the boundary. Malformed input produces a clear error; it never produces a crash.

### 19.5 Failure Is Contained by Construction

One plugin failing affects its own surfaces. One surface failing affects its own bounds. One theme token failing falls back while the theme still applies. Extensions that fail repeatedly are quarantined with the reason recorded, and only the user re-enables them.

### 19.6 The Scope of This Responsibility

Per §3.2: DevDesk owns the security of **its own extension boundary**, completely. It owns **nothing** about the machine's security posture. It is not antivirus, not a firewall, not a hardening tool, and it must never present itself as protecting the user from anything other than DevDesk's own extensions.

---

## 20. AI-Assisted Development Workflow

AI agents are **first-class contributors** to this repository, and this shapes the engineering practice rather than sitting beside it.

**Agents are bound by exactly the same contracts as humans.** The same Definition of Done, the same review criteria, the same ADR requirement, the same anti-pattern checklist. There is no relaxed standard for generated code.

**Contracts are machine-readable, not prose-only.** The generated API surface is committed so an agent reads the true contract rather than a description of it. This is a direct reason the contract is generated (§17.2).

**Ambiguity is a defect in the document, not a decision for the agent.** When an agent finds a specification unclear, the correct action is to raise it — never to pick an interpretation and implement it. An agent that guesses well is more dangerous than one that guesses badly, because nobody notices.

**Generated artifacts are never hand-edited.** Neither by humans nor by agents.

**Security-sensitive files require human review.** Capability declarations and security configuration are never modified by an agent without explicit human sign-off.

**Every agent session is logged** with what was done, what changed, what was decided, and what comes next — in `.ai/SESSION.md`.

**This document is mandatory reading before any agent task.** That obligation is normative and therefore lives in [`.ai/AGENTS.md`](.ai/AGENTS.md) — the vendor-neutral agent contract — rather than in any per-vendor file (§29, LR-3).

---

## 21. Engineering Principles

These are the working principles. Their enforced, numbered forms live in `SYSTEM_ARCHITECTURE.md`.

**Architecture, then specification, then implementation.** Never implement before the specification exists. Never create architecture that contradicts an existing document — amend it by ADR instead.

**One owner per responsibility.** No two modules own the same thing. Duplicate responsibility is treated as a defect, in code and in documentation alike.

**Prefer extension over modification.** The core stays small.

**Errors are values, and every error is actionable.** An error tells the caller whether to retry, what to fix, or that the state is terminal. One that tells the caller nothing is a design defect.

**Parse at the boundary.** External input becomes a validated domain type at the edge, or it is rejected. Nothing raw travels inward.

**Make the wrong thing impossible, not merely prohibited.** Where a rule can be enforced by a type, a compiler error, a lint, or a directory structure, it is — because rules that rely on memory are rules that fail under deadline pressure.

**Bound everything.** Every queue, every mailbox, every retry, every timeout. An unbounded queue turns a slow consumer into unbounded memory growth, which then presents as a leak and is diagnosed as the wrong problem entirely.

**Measure before optimizing.** Performance work starts with a recorded baseline. Speculative optimization without one fails review.

**Optimize for maintainability over cleverness.** This is a long-horizon project with a small team. Fewer, stronger boundaries beat many thin abstractions.

**A repeated request for an exemption is evidence the rule is wrong.** It is routed to an ADR amendment, never granted as a one-off — one-off exemptions are how invariants die.

---

## 22. Design Debt Policy

Technical debt on this project is not "code we will tidy up later." The five patterns below are **structural**: each one, once merged, makes a boundary unenforceable, and every feature built afterward deepens the dependency on it. They are trivial to refuse at review and extremely expensive to remove afterward — which is why they are refused at review.

### 22.1 The Rule

**If a feature requires any of the following, the implementation is redesigned before it merges.**

Not merged with a `TODO`. Not merged behind a flag. Not merged "temporarily until we refactor." Not merged with a follow-up ticket.

| Trigger | Boundary it breaks | Why it cannot be paid down later |
| --- | --- | --- |
| **Global mutable state** | `B-2`, `B-7` | A second authority over state does not stay contained. Every later reader is written against it, so removing it means rewriting all of them at once — and the divergence bugs it causes reproduce only under timing nobody can recreate |
| **Undocumented IPC** | `B-3` | The contract is generated and diff-gated precisely so it cannot drift. A command outside it is invisible to versioning, to plugin compatibility checks, and to review — and it is a hole in a trust boundary, not just a typing gap |
| **Theme-specific logic** | `B-10`, `D-8` | The moment an engine knows about one theme, that theme is load-bearing and every other theme is second-class. One visual system (§15.4) survives exactly zero exceptions |
| **Widget-to-widget coupling** | `B-11`, `D-9` | Isolation is what makes failure local (§10.4) and what lets a third-party surface be trusted at all. A direct coupling between two surfaces breaks both properties for the whole system, not just for those two |
| **Plugin-specific exceptions** | `B-10`, `P-7` | A special case for one plugin is a privileged path, and a privileged path is the mechanism by which plugin-first platforms decay (§11.4). This applies to first-party plugins first and most strictly |

### 22.2 When Redesign Genuinely Is Not Possible

Sometimes it is not the implementation that is wrong. If a feature cannot be built without one of these, **the finding is that the architecture is missing something** — and that is a result, not a blocker.

It becomes an `ARCHITECTURE_CHANGE` issue and, if accepted, an ADR that extends the contract **for everyone**. The feature then waits for the contract, or the contract changes generically.

What does not happen is one exception, for one feature, this once. That is how every one of these patterns enters a codebase, and it is never how it leaves.

### 22.3 What This Policy Is Not

This does not prohibit **incompleteness**. A feature that does less than intended, a budget still marked provisional (§0.4), a platform capability that reports itself unsupported, a stage that has not shipped — these are bounded, recorded, and visible, and the repository is full of them by design.

Design debt is a **structural violation**, not an unfinished thing. The distinction is simple: an incomplete feature costs what it costs. A boundary violation charges interest to every feature written after it.

### 22.4 The Review Question

One question decides it:

> **Does this work *because of* the contract, or *in spite of* it?**

If the answer is the second, the design is wrong even when the code is correct, the tests pass, and the feature works.

---

# Part IV — Platform Architecture

---

## 23. Architectural Boundaries

These are the invariants that define DevDesk architecturally. They are stated here in one sentence each so that a reader of this document knows what may not be crossed; their enforced form, with numbered rules and tooling, is owned by [`SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md) and ratified by [`ADR-0001`](docs/adr/ADR-0001-system-architecture.md).

| # | Boundary |
| --- | --- |
| **B-1** | Dependencies flow in one direction only, and the graph has no cycles |
| **B-2** | The Rust core is the single source of truth for all durable and shared state |
| **B-3** | Every native capability crosses one generated, versioned, typed contract |
| **B-4** | The Rust capability gate is the only authorization point in the system |
| **B-5** | Untrusted code is sandboxed; untrusted data is validated at the boundary |
| **B-6** | Every failure has a declared, bounded blast radius |
| **B-7** | Shared state is partitioned and reached by message, never by a global lock |
| **B-8** | Performance budgets are contracts with harnesses, not aspirations |
| **B-9** | Platform differences are explicit, introspectable, and never silent |
| **B-10** | Themes contain no logic; extensions depend only on the public SDK; the core never depends on an extension |
| **B-11** | Surfaces never communicate directly — everything goes through a defined contract |
| **B-12** | Every user-reachable action is expressible as a command; no UI-only paths (§12.1 F-5) |

**A proposal that crosses one of these is an architecture change by definition**, and requires an ADR. It is not a matter of code review judgement.

---

## 24. Decision-Making Principles

**Vision constrains architecture; architecture constrains implementation.** A decision at any level must serve the level above it. An implementation convenience never justifies an architectural violation, and an architectural elegance never justifies contradicting the product.

**Prefer the decision that is cheap now and expensive later to reverse — made now.** Directory structure, the extension contract, the state model, and the trust model all become effectively permanent the moment a public SDK ships. Deciding them under a prototype's local pressures is how they get decided badly.

**When two options are close, choose the one with the smaller public surface.** Every public API is a permanent obligation on a small team with a long horizon.

**When evidence is absent, say so and name what would settle it.** A provisional decision with a named validating experiment is honest and actionable. A confident guess is neither.

**A rule that cannot be enforced is a preference.** State it as one, or find a mechanism.

**Escalate contradictions; do not resolve them locally.** Two documents disagreeing is a defect that gets an issue and an ADR, not an interpretation at the keyboard.

**Reverse decisions loudly.** A superseded ADR keeps its number and gains a pointer forward. The reason an option was rejected is the most frequently re-litigated information on a long project.

**Scope is defended, not negotiated per-feature.** §7 exists so that "should we add this?" has a written answer before anyone is emotionally invested. Moving something from §7.2 into V1 is a decision with a record, not a conversation.

**Prefer fewer, stronger boundaries.** Small team, long horizon.

---

# Part V — Repository, Roadmap, and Vocabulary

---

## 25. Repository Philosophy

### 25.1 Three Sources of Truth

| Location | Owns | Question It Answers |
| --- | --- | --- |
| `docs/` | Specifications, architecture, ADRs | *What should the system do?* |
| `knowledge/` | Benchmarks, spikes, research, measurements | *What have we learned?* |
| `.ai/` | Agent contract, rules, review criteria, logs | *How should agents work?* |

Plus this document at the root, which answers *why does any of it exist?*

Measurements never live in `docs/`. Specifications never live in `knowledge/`. Normative rules never live in `.ai/`.

### 25.2 Three Levels of Abstraction

**Level 1 — Vision** rarely changes: this document, `governance/`, `README.md`, `planning/`.
**Level 2 — Architecture** changes occasionally and only by ADR: `docs/`, the public SDK surface.
**Level 3 — Implementation** changes constantly: everything else.

Levels are never mixed. Implementation detail in a vision document, or product narrative in an architecture document, is a defect in that document.

### 25.3 No Placeholders, No Empty Documents

**An empty or placeholder document is worse than a missing one.** A missing document is an obvious gap; an empty one is a promise the repository does not keep, and an AI agent reading it will infer structure that does not exist and generate against it.

Every document in this repository is either complete, or it does not exist yet. A document is written when it is needed and written properly, or its file is not created.

### 25.4 Documentation Is Written to Be Implemented From

Every document is written as though a senior engineer will implement directly from it without asking a question. No tutorial voice. No generic explanation of well-known concepts. No filler sections. If a section has nothing specific to say, it is removed rather than padded.

### 25.5 Each Fact Has Exactly One Home

Documents reference each other; they do not restate each other. Duplicated content diverges, and the reader cannot tell which copy is current. §0.4 is the single, narrow, explicitly-bounded exception.

### 25.6 Everything Consequential Is Recorded

Architectural decisions become ADRs. Measurements become documents in `knowledge/`. Agent sessions become entries in `.ai/SESSION.md`. A decision that exists only in someone's memory or in a chat log does not exist — this document is itself the correction of exactly that failure (§30).

---

## 26. Long-Term Roadmap Vision

Horizons, not dates. Each is defined by what becomes **true**, not by what has been built. **V1 (§7) spans Horizons 1 and 2 plus the public SDK from Horizon 3.**

### Horizon 1 — Foundation
The contracts exist and are enforced: the workspace, the generated IPC contract, the platform abstraction, the state kernel, storage. Nothing is user-visible. This horizon exists so that everything after it is additive rather than a migration.

### Horizon 2 — A Desktop You Own
A user can place, arrange, theme, and persist a real desktop across multiple monitors, and it survives docking, reboots, and updates. Glass works and degrades honestly. Safe Mode works. **§5's five origin frustrations are all solved.** This is the first horizon at which DevDesk is a product.

### Horizon 3 — An Open Platform
The plugin SDK is public and stable. Third parties ship surfaces and themes that are visually coherent with everything else and are capability-gated. First-party surfaces are indistinguishable from third-party ones in capability, because they use the same contract. **The SDK ships in V1; the ecosystem it enables grows after.**

### Horizon 4 — Authoring
Studio: building surfaces, themes, and layouts inside DevDesk rather than in a text editor. This is what widens the audience from §8.1/§8.2 to §8.3.

### Horizon 5 — Distribution
A signed marketplace with reviews and update channels. Bundle signing and capability declaration are built in Horizon 3 rather than retrofitted here, because a trust model cannot be added to an installed base without breaking it.

### Horizon 6 — Everywhere
macOS and Linux as genuine peers. The platform abstraction and the three-webview CSS baseline are maintained from Horizon 1 for this reason, and the cost is paid continuously rather than as a port.

### Beyond
Automation for power users, richer surface backends for high-frequency content, optional configuration sync, stronger extension isolation. Each is a **designed-for seam** with a constraint already being paid today (§7.2) — the seams stay open because the constraints are enforced now, not because they are written down.

---

## 27. Success Metrics

Product-level, and deliberately distinct from the engineering budgets in §6.2.

### Experience

| # | Metric |
| --- | --- |
| **S-1** | A new user builds a desktop they are happy with **without reading documentation** |
| **S-2** | A user docks, undocks, changes resolution, and updates DevDesk — and their layout is intact every time |
| **S-3** | Zero reports of a silently lost arrangement. *This is the metric with no acceptable nonzero value* |
| **S-4** | A user can answer "what is running and what can it access?" from within the product, in under thirty seconds |
| **S-5** | DevDesk running all day is not perceptible in machine responsiveness |
| **S-6** | Every core action is reachable from the keyboard without consulting documentation |

### Ecosystem

| # | Metric |
| --- | --- |
| **S-7** | A theme author restyles the entire desktop, including third-party surfaces, **writing no code** |
| **S-8** | A developer ships a working surface in under an hour, using only public documentation |
| **S-9** | Third-party surfaces are visually indistinguishable from first-party ones under any theme |
| **S-10** | First-party surfaces require **zero** capabilities, manifest fields, or build paths unavailable to third parties |
| **S-11** | A plugin author never needs to ask what a permission means — the grant prompt already said it |

### Trust

| # | Metric |
| --- | --- |
| **S-12** | Zero bytes leave the machine that the user did not explicitly authorize, per action |
| **S-13** | Uninstalling DevDesk restores an unmodified desktop with no repair step |
| **S-14** | No user is ever stuck in a broken desktop with no way back (§10.5) |
| **S-15** | Every failure a user sees names what broke, why, and what to do next |

---

## 28. Terminology and Glossary

Vocabulary discipline is not pedantry here — the same object called three things in three documents is how specifications drift apart. **Each term below has exactly one definition, and this is where it lives.**

### 28.1 The Widget / Surface Rule

**"Widget" is user-facing vocabulary. "Surface" is the internal term.**

Users see widgets. Documentation for users says widgets. **Code, specifications, identifiers, and internal discussion say surface, without exception.** The reason is precision: "widget" carries a decade of accumulated meaning from other tools that DevDesk deliberately does not share, and using it internally imports assumptions the architecture rejects.

### 28.2 Core Terms

Each block is the authoritative definition. **"Never means"** is as binding as the definition.

---

**Widget**
- **Is:** The user-facing name for a thing a person places on their desktop.
- **Use when:** Writing for users — UI copy, onboarding, marketing, user documentation.
- **Never means:** Anything in code, a specification, or an identifier. Never a distinct architectural entity from *Surface*.
- **Internal counterpart:** Surface.

**Surface**
- **Is:** The unit of composition — a bounded, positioned, themed region backed by a plugin.
- **Use when:** Always, internally. Code, specifications, identifiers, architecture discussion.
- **Never means:** A window. A surface is placed *into* a window by the runtime; authors never manage windows.
- **User-facing counterpart:** Widget.

**Panel**
- **Is:** A **product role**, not a type — a surface anchored to a screen edge, typically holding several elements (a bar, a dock, a status strip).
- **Use when:** Describing a layout pattern to users or in design documents.
- **Never means:** A distinct architectural entity. There is no panel type, no panel runtime, no panel API. A panel is a surface with an edge anchor, and code that invents a `Panel` abstraction is wrong.

**Workspace**
- **Is:** The user-facing name for a named, switchable set of layouts a person moves between.
- **Use when:** Writing for users.
- **Never means:** A virtual desktop (that is a Windows concept DevDesk does not own — §3), or a repository workspace (that is a build-tool concept — see *Monorepo workspace*).
- **Internal counterpart:** Profile.

**Layout**
- **Is:** Where surfaces sit for **one** monitor topology — monitor, layer, anchor, size, z-order.
- **Use when:** Both user-facing and internal; the term is the same on both sides.
- **Never means:** The arrangement across all possible monitor setups. That is a set of layouts, selected by topology. One layout belongs to one topology.

**Theme**
- **Is:** A set of token values that restyles the entire desktop. **Data. Never code.**
- **Use when:** Both user-facing and internal.
- **Never means:** A stylesheet, a skin, or anything containing logic, scripting, or executable content of any kind (§11.1).

**Plugin**
- **Is:** An installable bundle providing surface types and capabilities, running capability-gated in a sandbox.
- **Use when:** Both user-facing and internal.
- **Never means:** A first-party-only mechanism. First-party and third-party plugins are the same thing with the same contract and the same gate (§11.4).

**Engine**
- **Is:** A subsystem owning exactly one domain — Theme Engine, Widget Runtime, Layout Engine, Plugin System.
- **Use when:** Naming a subsystem with a single, complete area of responsibility.
- **Never means:** A general-purpose grab-bag. If two engines own overlapping responsibility, one of them is misnamed and it is a defect (§21).

---

### 28.3 Supporting Terms

| Term | Definition |
| --- | --- |
| **Token** | A single named visual value — colour, spacing, radius, blur, shadow, duration, easing. The atom of the theme system |
| **Layer** | The z-order band a surface occupies: wallpaper, desktop, normal, overlay, system |
| **Anchor** | Placement relative to a screen edge or corner, so it survives resolution and DPI changes. The default placement mode |
| **Topology** | The complete monitor arrangement: count, sizes, positions, scale factors, refresh rates |
| **Profile** | Internal counterpart of *Workspace* — the named set of layouts |
| **Capability** | A named, scoped permission a plugin declares and a user grants |
| **Grant** | A user's persisted, revocable authorization of a capability to a specific plugin |
| **Safe Mode** | Default theme, no plugins, minimal surfaces — the guaranteed escape hatch |
| **Rice** | Community term for a deeply personalized desktop. Used in vision discussion only; never an identifier |
| **Monorepo workspace** | A build-tool concept (Cargo, pnpm) — unrelated to *Workspace*. Always qualified when both could be meant |

### 28.4 Where the Rest Lives

The technical glossary — actor, blast radius, coalescing, delta, projection, revision, scope, topology fingerprint, trust zone — is owned by `SYSTEM_ARCHITECTURE.md` §28 and is not duplicated here. Budget identifiers (`PB-*`) are owned by [`ADR-0002`](docs/adr/ADR-0002-performance-budgets.md) §7.

---

# Part VI — Record

---

## 29. Contradictions Resolved

This document reconciles the project's conversational history, this revision's reviewer feedback, and the ratified repository baseline. Where they disagreed, the more mature decision was taken and the reasoning recorded.

### 29.1 Resolved in v1.0.0

| # | Contradiction | Resolution |
| --- | --- | --- |
| **LR-1** | Conversational vocabulary treats *widget*, *surface*, *panel*, and *workspace* as four distinct entities; the architecture defines *surface* as the sole unit and *widget* as user-facing vocabulary only | **Architecture wins**, as the more precise decision. §28 keeps all four as **product** vocabulary and maps panel → anchored surface, workspace → profile. No new architectural entity is introduced. |
| **LR-2** | "Widget-first architecture" implies widgets as a first-class code location; [`ADR-0003`](docs/adr/ADR-0003-repository-layout.md) retired the `widgets/` directory because a separate first-party home *is* the privileged path the plugin-parity commitment forbids | **ADR-0003 wins.** "Widget-first" is a **product** stance (§11.3) — the everyday loop is adding and arranging widgets — expressed entirely through the plugin contract. |
| **LR-3** | The hierarchy called for updating a per-vendor AI file to mandate reading this document; ADR-0003 prohibits normative content in per-vendor agent files | **Both intents satisfied.** The mandate is normative, so it goes in the vendor-neutral [`.ai/AGENTS.md`](.ai/AGENTS.md); per-vendor files point at it (§20, §31.2). The mandate is preserved; the structural defect that let performance targets diverge is not repeated. |
| **LR-4** | The hierarchy places this document above governance and architecture as *the* source of truth; ADR-0001 §3.4 places Level 1 documents **below** ADRs and the architecture on architectural questions | **Both are right about different things.** §0.2 separates **reading order** (this document first, always) from **precedence** (architecture supreme on architecture). "Vision drives architecture" is preserved with teeth: a conflict presumes the architecture wrong and escalates it. |
| **LR-5** | This document was specified to contain architecture, performance, and engineering rules; the repository's no-duplication rule and level discipline forbid Level 2 content in a Level 1 document | **Level discipline wins.** All requested subjects are covered, but architectural sections state **intent and rationale** and reference the owning documents for enforced rules. |
| **LR-6** | The repository variously describes DevDesk as a "developer desktop environment," a "workspace for developer productivity," and a "desktop customization platform" | **"Desktop experience platform" (§1)**, with developers and power users as the *initial* audience (§8) rather than the definition. Productivity is an outcome of ownership, not the product's category. |
| **LR-7** | The conversation's documentation waves versus the wave already executed, which delivered ADR-0001…ADR-0003 | **Reconciled in §31.1.** This document is Wave 0 alongside the ADRs. It *should* have preceded them, and because it did not, §31.3 makes reconciling it against the architecture an explicit obligation. |
| **LR-8** | Rainmeter is simultaneously the project's origin and its explicit anti-goal | **Not actually a contradiction, and worth keeping visible.** Rainmeter is the **problem statement** (§5), never the **template** (§2). |

### 29.2 Resolved in v1.1.0

| # | Contradiction | Resolution |
| --- | --- | --- |
| **LR-9** | Reviewer requires the vision be measurable; §0.3 forbids this document from restating performance thresholds — and a second unenforced set of targets is exactly what produced ADR-0002 | **Both satisfied by §0.4.** Numbers appear **only as citations of an ADR-0002 budget ID**, never free-standing. ADR-0002 wins any disagreement, and a vision commitment with no budget ID is not a commitment. §6.2 is measurable; no second source of truth is created. |
| **LR-10** | The product-boundary list says DevDesk does not own *system security*, while §19 defines a rigorous security model | **Scoped, not contradictory (§3.2).** DevDesk owns its **extension boundary** absolutely and the **machine's security posture** not at all. It is not antivirus, a firewall, or a hardening tool, and must never present itself as one. |
| **LR-11** | The product-boundary list says DevDesk does not own *window management*, while it places, sizes, and z-orders windows | **Scoped, not contradictory (§3.2).** DevDesk manages **only its own surfaces**. It never moves, tiles, focuses, or reorders the user's application windows. A feature requiring arbitration over foreign windows is a window manager, and DevDesk is not one. |
| **LR-12** | Reviewer's *keyboard-driven workflows* is a new requirement with no expression anywhere in the architecture | **Adopted and given an architectural home.** It becomes `F-5` (§12.1), `P-13` (§14), `B-12` (§23), `V1-11` (§7.1), and `S-6` (§27). It maps onto an existing binding constraint — every user-reachable action must be expressible as a command — which was already being paid for the automation seam. Whether V1 also ships a command palette is raised as open question `Q-2` rather than assumed. |
| **LR-13** | Reviewer's V1 exclusion list omits capabilities the architecture already builds primitives for — bundle signing exists in V1, but the marketplace it serves does not | **Distinguished in §7.2.** Trust **primitives** (signing, capability declaration) ship in V1 because they cannot be retrofitted onto an installed base. The **products** built on them (marketplace, sharing) do not. Each X-entry states which side it is on. |

---

## 30. Provenance and Known Gaps

This section exists because a source-of-truth document that hides the limits of its own sourcing is not one.

### 30.1 What This Document Was Synthesized From

| Source | Contributed |
| --- | --- |
| The project's conversational history (shared ChatGPT transcript) | The origin narrative (§5), positioning against Rainmeter and Wallpaper Engine (§2, §9), the Linux-flexibility / Windows-native framing (§6, §12), the design and customization philosophy (§15, §11), the source-of-truth hierarchy (§0.2), the vocabulary set (§28), and the requirement that this document exist and be read first |
| Reviewer feedback (v1.1.0) | Measurable vision outcomes (§6.2), explicit V1 scope (§7), product boundaries (§3), the Part I–IV philosophy split, the concrete definition of "Linux flexibility" (§12), and the restructured glossary (§28) |
| [`docs/architecture/SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md) and [`docs/adr/`](docs/adr/) | Everything architectural — §17, §18, §19, §23 state their intent and reference them for the rules; §6.2 cites their budget IDs |
| `governance/`, `.ai/`, `README.md` | Repository philosophy (§25), engineering principles (§21), the AI workflow (§20) |

### 30.2 What Could Not Be Recovered

**The shared conversation's substance was carried substantially in uploaded images and files, which the share page renders only as attachment placeholders. That content was not readable.**

From surrounding text, those attachments included: screenshots of the working Rainmeter setup, the laptop and monitor hardware, the multi-monitor failure, a Spotify player widget, weather widget configuration, and at least two uploaded files describing the repository's then-current state.

Concretely, this means the following are **reconstructed from the repository and from the conversation's readable text, not from a primary visual record**:

- the precise visual target — actual mockups, reference desktops, colour direction, and specific glass treatments;
- the exact first-party surface set the project intends to ship;
- any concrete UI layout for settings, the library, or onboarding;
- specific Rainmeter behaviours that were being reacted to, beyond those named in text.

**§15 (design philosophy) is therefore the weakest-sourced section in this document.** It is consistent with everything stated in text and with the architecture, but it describes *principles* rather than a *visual specification*, and it should not be treated as one.

### 30.3 What Would Close These Gaps

The design-visual gap is closed by `docs/design/DESIGN_SYSTEM.md`; the surface-set and UI gap by `docs/product/PRODUCT_SPEC.md`. Both are Wave 1 deliverables (§31.1). **Re-supplying the original screenshots and reference material into `docs/design/` or `knowledge/` before authoring them would materially improve both** — and per §25.6, doing so converts a chat attachment into a durable project record, which is the whole point.

---

## 31. Position in the Repository

### 31.1 Reading Order

```text
PROJECT_CONTEXT.md          ← you are here · why DevDesk exists · read first, every time
        ↓
governance/                 ← how decisions get made
        ↓
docs/adr/ADR-0001…0003      ← what has been decided
        ↓
docs/architecture/          ← how the system is built
        ↓
docs/product/ · docs/design/ · docs/api/ · docs/sdk/
        ↓
Implementation
```

### 31.2 Amendments This Document Requires

This document is Level 1 and does not modify other files. The following corrections belong in the Wave 1 amendment pass, alongside those already listed in ADR-0003 §10.2:

| Document | Amendment |
| --- | --- |
| [`.ai/AGENTS.md`](.ai/AGENTS.md) | Add the mandate: read `PROJECT_CONTEXT.md` before any task (§20, LR-3). Correct the workspace list — it still names `widgets/`, retired by ADR-0003 |
| [`.ai/CLAUDE.md`](.ai/CLAUDE.md) and other per-vendor files | Reduce to adapters that point at `AGENTS.md`; no normative content (LR-3) |
| [`README.md`](README.md) | Lead with §1's definition; link this document first (LR-6) |
| [`governance/PROJECT_CONSTITUTION.md`](governance/PROJECT_CONSTITUTION.md) | Correct the mandate from "developer productivity" to the §1 definition (LR-6); register this document as a Level 1 source |
| [`governance/ARCHITECTURE_PRINCIPLES.md`](governance/ARCHITECTURE_PRINCIPLES.md) | Add `PROJECT_CONTEXT.md` to the Level 1 location list |
| [`ADR-0003`](docs/adr/ADR-0003-repository-layout.md) §4.1, §5.1, RL-21 | Register `PROJECT_CONTEXT.md` as a root-level Level 1 document owned by the Lead Architect |
| [`ADR-0002`](docs/adr/ADR-0002-performance-budgets.md) §13.3 | Add a review trigger: a change to any budget cited in §6.2 requires updating that citation, so the two cannot silently diverge (LR-9) |
| [`SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md) §26.7 | Note that the automation seam's constraint is now also a V1 product requirement (`F-5`, `B-12`, `V1-11`), not only a future-facing one (LR-12) |
| [`.ai/CODE_REVIEW.md`](.ai/CODE_REVIEW.md) | Adopt §22's five triggers and §22.4's review question as blocking review criteria. A policy with no review home is a preference (§21) |
| [`SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md) §25.4 | Add the §22.4 question to the Definition of Done, so design debt is checked on every change rather than only when someone notices |

### 31.3 The Reconciliation Obligation

[`ADR-0001`](docs/adr/ADR-0001-system-architecture.md) R-1 recorded a specific risk: *the architecture was ratified without a product specification, and its quality-attribute scenarios encode product assumptions nothing ratified supports.*

This document discharges part of that risk and creates a matching obligation. **Before Wave 1 closes, the architecture's quality-attribute scenarios and constraints MUST be checked against §5, §7, §8, §10, and §13 of this document.** Where they diverge — a different primary workload, a different monitor count, a different weight on glass — the divergence is an `ARCHITECTURE_CHANGE` issue amending the architecture and ADR-0002's workloads. It is not a mismatch to be lived with.

**§7 (V1 Scope) sharpens this obligation.** The architecture's implementation stages and the V1 boundary must agree on what ships. Any capability in §7.1 without an architectural home, or any architectural work serving only §7.2 exclusions, is a scope mismatch to be resolved before implementation begins.

That is what "vision drives architecture" means operationally: the vision was written second, so the architecture now has to answer to it.

### 31.4 Changing This Document

This document is frozen (§0.6). This section is the complete mechanism for changing it.

#### The Rule

**No change to this document's substance is valid without an accepted ADR that names this document and states exactly what it amends.**

Not a PR with a good argument in its description. Not consensus in an issue thread. Not an update made while writing a downstream specification that needed this one to say something different. **The ADR is the artifact; the edit is its consequence.**

#### What Requires an ADR

Any change to meaning. Specifically and not exhaustively: the definition in §1; anything in §2, §3, or §4; the V1 boundary in §7.1 or §7.2; resolving `Q-1` or `Q-2` in §7.3; any principle in §14, §16, or §21; the design debt policy in §22; the boundaries in §23; a term's definition in §28; the addition or removal of any numbered item anywhere.

#### What Is Editorial

A narrow, closed list — narrow because a broad one would swallow the rule:

- fixing a typo, a grammatical error, or a broken link;
- correcting a cross-reference that points at the wrong section;
- renumbering that a previously accepted ADR made necessary;
- adding a revision-history row recording an accepted ADR's amendment.

**An editorial change may not alter what any sentence means.** If reasonable reviewers could disagree about whether a change is editorial, it is not — it is an amendment, and the disagreement is itself the evidence.

#### The Amending ADR

It carries the standard Document Control block (`ADR-0001` §3.5, D-12) and takes **the next free number in the register** — it does not reuse a number allocated to a planned ADR. It must state:

1. **Which section**, by number and by quoted text.
2. **The replacement text**, verbatim.
3. **Why the original was wrong** — not why the new version is attractive. This document was written from the project's founding intent; an amendment is a claim that the intent was misrecorded or has genuinely changed, and the ADR says which.
4. **What downstream work the change invalidates** — specifications, budgets, scope, or ADRs written against the old text.

**Deciders:** Lead Architect and Product, jointly. Neither alone.

On acceptance, the amending ADR is applied to this document, the version bumps, and §0.5 gains a row citing the ADR. The ADR remains the record; this document never carries the reasoning for its own changes.

#### The Stable Core

The **non-goals (§2, §4), the product boundaries (§3), the V1 exclusions (§7.2), the product principles (§14), the design debt policy (§22), and the architectural boundaries (§23)** are the stable core.

They are not amendable by accumulated practice, by a subsystem specification, or by a convenient exception — and now, not by any route except an ADR that says so on the record. Changing one requires stating plainly what replaces it and **why the project is now a different project than it was.**

#### Why Freeze It

A vision document that can be edited to match what was built is not a vision document; it is a changelog with aspirational formatting. Its entire value is that it was written **before** the pressure to compromise it existed, and that it stays fixed while everything downstream moves.

Freezing converts every future disagreement with this text from a quiet edit into a recorded decision. That is the whole mechanism — and it is the same reason ADRs exist at all (§24).

---

**This document is the answer to "why?" and "what, in the first release?" Everything else in this repository is an answer to "how?"**

*Read it before you write. If what you are about to build does not serve something written here, that is the finding — not an obstacle to work around.*
