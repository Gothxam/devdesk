# DevDesk V1 — MVP Acceptance Matrix

**Every acceptance criterion in the PRD, classified by whether it can block a release.**

> **Abstraction Level:** 📙 **Level 2** (per [`governance/ARCHITECTURE_PRINCIPLES.md`](../../governance/ARCHITECTURE_PRINCIPLES.md))
> **Parent:** [`PRD.md`](./PRD.md) — this document classifies; it does not add, remove, or reword requirements
> **Root:** [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md) 🔒

---

## Document Control

| Field | Value |
| --- | --- |
| **Document ID** | `MVP-0001` |
| **Status** | `PROPOSED` — becomes `ACCEPTED` on merge |
| **Version** | `1.0.0` |
| **Owner** | Chief Product Architect |
| **Reviewers** | Lead Architect, Core Engineering, Design, Security |
| **Classifies** | [`PRD.md`](./PRD.md) `1.1.0` — 92 requirements, **380 acceptance criteria** |
| **Change Policy** | Reclassifying a criterion requires review by Product and the Lead Architect. Moving a criterion **into** `Future` is a scope cut and additionally requires a PRD amendment (§9). |

### Count Correction

The PRD contains **380** acceptance criteria, not 381. The earlier figure counted the `AC-<AREA>-<n>.<m>` template row in the PRD's identifier table. Every total in this document reconciles against 380, and §11 shows the reconciliation.

The extraction that produced this matrix also surfaced a PRD defect: six criteria in §22.3 had no owning requirement. PRD `1.1.0` adds `FR-OFF-4` to own them.

---

## 1. Why This Document Exists

380 acceptance criteria treated as equally important is not a specification — it is an undifferentiated wall, and the predictable outcome is that a team either paralyses at Sprint 1 or silently picks its own priorities and calls the result V1.

This document makes the priority explicit and reviewable. It answers three questions the PRD deliberately does not:

1. **What must be true to ship?** — the Critical tier (§5), which *is* the minimum usable V1.
2. **What can slip, and to where?** — the Important and Optional tiers (§6).
3. **What should be cut now, before anyone builds it?** — the Future tier (§9).

It also answers a fourth question nobody asked but everybody needs: **what is the smallest build the team can actually use daily** (§7.2), because dogfooding is what surfaces the defects a specification cannot predict.

**This document changes no requirement.** It states which ones stop a release.

---

## 2. Classification Rules

A criterion's tier is **derived, not voted on.** The test below is applied in order; the first rule that matches determines the tier.

### 2.1 The Critical Test

A criterion is **Critical** if *any* of the following is true. If none is true, it is not Critical.

| # | Test | Source |
| --- | --- | --- |
| **C-1** | It is required by a `PROJECT_CONTEXT.md` §7.4 release condition | Frozen |
| **C-2** | It is the product's answer to an origin frustration `PS-1`…`PS-5` | PRD §2 — designated the project's acceptance test |
| **C-3** | It serves a success metric with **zero tolerance**: `S-3` (no silent loss), `S-10` (no privileged path), `S-12` (no egress), `S-15` (error quality) | PRD §4 |
| **C-4** | It is a security, trust, or authorization property | PRD §20 |
| **C-5** | It is a data-safety property — anything that can lose or corrupt the user's work | PRD §23 |
| **C-6** | It is an accessibility conformance property inside the §18.1 scope | PRD §24.5 gate |
| **C-7** | It enforces an architectural boundary `B-1`…`B-12` or a product principle `P-1`…`P-13` | Frozen |
| **C-8** | It is named as release-blocking in PRD §24 | PRD |
| **C-9** | Its absence leaves the user stuck, silently misled, or unable to recover | `P-9`, `P-10`, `S-14` |

### 2.2 The Remaining Tiers

| Tier | Test | What it means for the release |
| --- | --- | --- |
| **Important** | Not Critical, but its absence is a defect a reviewer would file | Ships as a **documented known issue**; fixed in a V1.0.x patch. More than ~15 open at release is a signal the release is premature |
| **Optional** | Not Critical; absence is a quality gap, not a defect | Built if the milestone has room. No known-issue entry, no patch commitment |
| **Future** | **Recommended for removal from V1 scope entirely** | Requires a PRD amendment (§9). Not built in V1. Listed here so it is not built by accident |

### 2.3 What the Rules Deliberately Do Not Include

- **Implementation cost.** A criterion is not downgraded for being expensive. Cost belongs in sequencing (§7), not in classification — conflating them is how security and accessibility get quietly deferred.
- **Confidence that it will be met.** A prototype-gated performance budget is classified on what it protects, not on whether the estimate survives.
- **Whether anyone has asked for it.** `PROJECT_CONTEXT.md` §7.1 is frozen; this document does not relitigate it.

---

## 3. Summary

| Tier | Count | Share | Release effect |
| --- | --- | --- | --- |
| 🔴 **Critical** | **212** | 56% | Blocks release |
| 🟡 **Important** | **137** | 36% | Ships as known issue; V1.0.x |
| 🔵 **Optional** | **22** | 6% | Build if room |
| ⚪ **Future** | **9** | 2% | Proposed cut — needs PRD amendment |
| | **380** | 100% | |

**On the 56%.** That is high for a typical product and correct for this one. DevDesk's release conditions include zero silent data loss, zero network egress, zero privileged first-party paths, WCAG 2.2 AA conformance, and multi-monitor correctness — five whole categories where the acceptable failure count is zero. Trust properties do not have a "mostly" setting.

The velocity answer is therefore **not** a shorter Critical list. It is §7: Critical is not one sprint, it is five milestones, and only 41 of those 212 are needed before the team can start using the product themselves.

### 3.1 By Area

| Area | 🔴 | 🟡 | 🔵 | ⚪ | Total | Critical share |
| --- | --- | --- | --- | --- | --- | --- |
| `FRE` First run | 14 | 10 | 2 | 0 | 26 | 54% |
| `THM` Theme | 13 | 11 | 1 | 4 | 29 | 45% |
| `WGT` Widget | 19 | 21 | 4 | 3 | 47 | 40% |
| `LAY` Layout | 10 | 7 | 2 | 1 | 20 | 50% |
| `MON` Multi-monitor | 19 | 11 | 2 | 0 | 32 | 59% |
| `SET` Settings | 8 | 6 | 0 | 1 | 15 | 53% |
| `KBD` Keyboard | 12 | 13 | 6 | 0 | 31 | 39% |
| `PLG` Plugin | 27 | 12 | 0 | 0 | 39 | 69% |
| `A11Y` Accessibility | 18 | 3 | 1 | 0 | 22 | 82% |
| `PERF` Performance | 7 | 15 | 2 | 0 | 24 | 29% |
| `SEC` Security | 23 | 3 | 0 | 0 | 26 | 88% |
| `ERR` Errors | 14 | 8 | 0 | 0 | 22 | 64% |
| `OFF` Offline | 12 | 5 | 0 | 0 | 17 | 71% |
| `DAT` Persistence | 16 | 12 | 2 | 0 | 30 | 53% |
| **Total** | **212** | **137** | **22** | **9** | **380** | **56%** |

**Reading the shape.** Security (88%), accessibility (82%), and offline (71%) are near-absolute because their criteria *are* the release gates. Performance is the lowest (29%) — not because speed is unimportant, but because `ADR-0002` already owns those thresholds and provides a recorded amendment path when an estimate proves wrong; what is Critical here is that budgets are **measured on the reference machine and honestly reported**, not that any particular provisional number holds.

---

## 4. The Matrix

Criteria are listed by suffix; the area is implied by the requirement. Every criterion in the PRD appears exactly once.

### 4.1 First-Run Experience — 26

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-FRE-1` Populated desktop at first paint | 1.1, 1.2, 1.3, **1.4** | — | — | — |
| `FR-FRE-2` Three steps, skippable | 2.2, 2.6 | 2.1, 2.3, 2.4 | 2.5 | — |
| `FR-FRE-3` Appearance step | 3.1 | 3.2, 3.3, 3.4 | — | — |
| `FR-FRE-4` Displays step | 4.2 | 4.1, 4.3 | 4.4 | — |
| `FR-FRE-5` Startup step | 5.2, 5.3, 5.4 | 5.1 | — | — |
| `FR-FRE-6` Default arrangement | 6.1, 6.2, 6.4 | 6.3 | — | — |

**`AC-FRE-1.4` — zero permission prompts on first run — is Critical.** A user's first encounter with the grant model must be one they initiated; a prompt before they have done anything teaches them to dismiss prompts, which destroys the value of every later one (`S-11`).

### 4.2 Theme Management — 29

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-THM-1` Theme library | 1.3 | 1.1 | — | 1.2 |
| `FR-THM-2` Live preview | — | — | — | 2.1, 2.2, 2.3 |
| `FR-THM-3` Apply without reload | 3.1, 3.2, 3.4 | 3.3 | — | — |
| `FR-THM-4` Revert | 4.2 | 4.1 | — | — |
| `FR-THM-5` Modes | — | 5.1, 5.2 | — | — |
| `FR-THM-6` A11y overrides unconditional | 6.1, 6.3 | 6.2 | — | — |
| `FR-THM-7` Sideload install | 7.2, 7.3, 7.4 | 7.1, 7.5 | — | — |
| `FR-THM-8` Effect quality | 8.2 | 8.1 | 8.3 | — |
| `FR-THM-9` Degradation observable | 9.1, 9.4 | 9.2, 9.3 | — | — |

`FR-THM-2` is entirely `Future` — see §9. `AC-THM-3.1` and `3.4` are the direct answer to `PS-1` and are the reason the theme engine exists at all.

### 4.3 Widget Management — 47

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-WGT-1` Library | 1.2, 1.3 | 1.1, 1.4 | 1.5 | — |
| `FR-WGT-2` Add | 2.1, 2.4 | 2.2, 2.3, 2.5 | — | — |
| `FR-WGT-3` First-party set | 3.1, 3.2, 3.3, 3.4 | 3.5 | — | — |
| `FR-WGT-4` Move | 4.2, 4.3, 4.4, 4.5 | 4.1, 4.6 | — | — |
| `FR-WGT-5` Snap | — | 5.1, 5.2, 5.4 | 5.3 | — |
| `FR-WGT-6` Resize | 6.1, 6.5 | 6.2, 6.3 | 6.4 | — |
| `FR-WGT-7` Z-order | 7.1 | 7.2, 7.3 | — | — |
| `FR-WGT-8` Configure | 8.3, 8.4 | 8.1, 8.2 | — | — |
| `FR-WGT-9` Remove with undo | 9.1, 9.4 | 9.2 | 9.3 | — |
| `FR-WGT-10` Duplicate | — | — | — | 10.1, 10.2 |
| `FR-WGT-11` Lock and hide | — | 11.2, 11.3, 11.4 | — | 11.1 |

`AC-WGT-4.5` — a widget cannot be dropped fully off-screen — is Critical because an unreachable widget is a lost widget, and `S-3` has no tolerance. `AC-WGT-3.1`…`3.4` carry `S-10`, which §24.2 makes release-blocking.

### 4.4 Layout Management — 20

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-LAY-1` Self-saving | 1.1, 1.2, 1.3 | 1.4 | — | — |
| `FR-LAY-2` Anchored by default | 2.1, 2.2 | 2.3 | 2.4 | — |
| `FR-LAY-3` Reset | 3.1 | 3.2, 3.3 | — | — |
| `FR-LAY-4` Workspaces | 4.1, 4.2 | 4.4, 4.5 | — | 4.3 |
| `FR-LAY-5` Switching | 5.2, 5.4 | 5.1 | 5.3 | — |

`AC-LAY-1.2` and `1.3` — survives forced termination and power loss — are the mechanical guarantee behind `S-3`. They are not "robustness polish"; they are the feature.

### 4.5 Multi-Monitor — 32

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-MON-1` Identity not index | 1.1, 1.2, 1.3, 1.4 | — | — | — |
| `FR-MON-2` Layouts bound to arrangements | 2.1, 2.2, 2.3 | — | 2.4 | — |
| `FR-MON-3` Hotplug | 3.3, 3.4 | 3.1, 3.2, 3.5 | — | — |
| `FR-MON-4` Disconnected preserves | 4.1, 4.2 | 4.3 | 4.4 | — |
| `FR-MON-5` Unknown arrangements | 5.1, 5.2, 5.4 | 5.3 | — | — |
| `FR-MON-6` Mixed DPI | 6.1, 6.2, 6.3 | 6.4, 6.5 | — | — |
| `FR-MON-7` Mixed refresh | 7.1 | 7.2, 7.3 | — | — |
| `FR-MON-8` Assign to monitor | 8.2 | 8.1, 8.3 | — | — |

**`FR-MON-1` is Critical in full.** Monitor identity is the single decision that separates DevDesk from the tools in `PROJECT_CONTEXT.md` §5. If identity is wrong, every layout guarantee downstream is wrong, and the failure is exactly `PS-3`.

### 4.6 Settings — 15

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-SET-1` Nine sections | 1.2 | 1.1, 1.3 | — | 1.4 |
| `FR-SET-2` Permissions answers `S-4` | 2.1, 2.2, 2.3, 2.4 | 2.5 | — | — |
| `FR-SET-3` Provenance | — | 3.1, 3.2, 3.3 | — | — |
| `FR-SET-4` Restore points | 4.1, 4.2, 4.3 | — | — | — |

`FR-SET-2` is almost entirely Critical: it is the whole of `S-4`, and "what is running and what can it access?" is the question the capability model exists to let a user answer.

### 4.7 Keyboard — 31

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-KBD-1` Command coverage | 1.1, 1.2, 1.4 | 1.3 | — | — |
| `FR-KBD-2` Keyboard-only journeys | 2.1, 2.2, 2.3, 2.4 | — | — | — |
| `FR-KBD-3` Widget navigation mode | 3.2, 3.3, 3.6 | 3.1, 3.5 | 3.4 | — |
| `FR-KBD-4` Global shortcuts | 4.2, 4.4 | 4.1, 4.3 | — | — |
| `FR-KBD-5` Discoverability | — | 5.1, 5.2 | 5.3, 5.4 | — |
| `FR-KBD-6` Rebinding | — | 6.1, 6.2, 6.3 | 6.4 | — |
| `FR-KBD-7` Command palette *(conditional on `Q-2`)* | — | 7.1, 7.2, 7.3 | 7.4, 7.5 | — |

**`FR-KBD-7` is classified Important, with an escalation clause.** If the `S-6` usability evaluation (PRD §4) fails without a palette — participants unable to reach core actions from the keyboard without documentation — then `AC-KBD-7.1`…`7.3` **escalate to Critical**, because `S-6` is a §24.5 release gate and the palette becomes the only route to it. This is the one place in the matrix where a measurement, not a judgement, sets the tier.

### 4.8 Plugin Experience — 39

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-PLG-1` Install | 1.2, 1.4 | 1.1, 1.3, 1.5 | — | — |
| `FR-PLG-2` Validation reports specifically | 2.1, 2.2, 2.3, 2.4 | — | — | — |
| `FR-PLG-3` Enable/disable/uninstall | 3.3, 3.4 | 3.1, 3.2, 3.5 | — | — |
| `FR-PLG-4` Grant prompt | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 | 4.7 | — | — |
| `FR-PLG-5` Narrow grants | 5.1, 5.2, 5.3 | 5.4 | — | — |
| `FR-PLG-6` Failure contained | 6.1, 6.2, 6.3, 6.6 | 6.4, 6.5 | — | — |
| `FR-PLG-7` Trust primitives | 7.1, 7.2 | 7.3 | — | — |
| `FR-PLG-8` Author is first-class | 8.1, 8.2, 8.3, 8.5 | 8.4 | — | — |

**Zero Optional and zero Future.** The plugin surface is where the platform's trust model is either real or theatre, and there is no version of it that ships partially. `AC-PLG-8.1` (zero first-party exceptions) and `AC-PLG-8.3` (three external developers) are named release-blocking in PRD §24.2.

### 4.9 Accessibility — 22

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-A11Y-1` Keyboard | 1.1, 1.2, 1.3, 1.4 | — | — | — |
| `FR-A11Y-2` Screen reader | 2.1, 2.2, 2.4, 2.5 | 2.3 | — | — |
| `FR-A11Y-3` System preferences | 3.1, 3.2, 3.3, 3.4, 3.6 | 3.5 | — | — |
| `FR-A11Y-4` Contrast and colour | 4.1, 4.2, 4.3 | 4.4 | — | — |
| `FR-A11Y-5` Target size and motion | 5.1, 5.2 | — | 5.3 | — |

82% Critical because PRD §24.5 makes WCAG 2.2 AA a release gate. The three Important entries are tooling and timing (`4.4` the CI audit, `3.5` the no-restart requirement, `2.3` a mode announcement), not the conformance properties themselves.

### 4.10 Performance — 24

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `NFR-PERF-1` Ready quickly | 1.5 | 1.1, 1.2, 1.3, 1.4 | — | — |
| `NFR-PERF-2` Plugins never slow startup | **2.1** | — | — | — |
| `NFR-PERF-3` Idle imperceptible | 3.2 | 3.1, 3.3, 3.4, 3.6 | 3.5 | — |
| `NFR-PERF-4` Interaction smooth | — | 4.1, 4.2, 4.3 | — | — |
| `NFR-PERF-5` Changes immediate | — | 5.1, 5.2, 5.3 | 5.4 | — |
| `NFR-PERF-6` Quitting immediate and lossless | 6.2, 6.3 | 6.1 | — | — |
| `NFR-PERF-7` Measured, not assumed | 7.1, 7.2 | — | — | — |

**The Critical entries here are the structural ones, not the thresholds.** `AC-PERF-2.1` (installed plugins add zero startup cost) and `AC-PERF-3.2` (zero idle repaints) are zeros, not tolerances — a nonzero result means the architecture's central claims are false. `AC-PERF-7.1`/`7.2` are Critical because `PROJECT_CONTEXT.md` §7.4 condition 3 requires budgets to be *measured and either met or amended on the record*; shipping without measuring is the failure, not shipping a number that moved.

Individual thresholds are Important because `ADR-0002` §13.2 already provides the amendment path, and most are prototype-gated.

### 4.11 Security — 26

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-SEC-1` Authorization never assumed | 1.1, 1.2, 1.4, 1.5 | 1.3 | — | — |
| `FR-SEC-2` Prompt integrity | 2.1, 2.2, 2.3, 2.4 | — | — | — |
| `FR-SEC-3` Revocation immediate | 3.1, 3.2, 3.3 | 3.4 | — | — |
| `FR-SEC-4` No egress | 4.1, 4.2, 4.3, 4.4 | — | — | — |
| `FR-SEC-5` Themes cannot execute | 5.1, 5.2 | — | — | — |
| `FR-SEC-6` Errors disclose nothing | 6.1, 6.2 | 6.3 | — | — |
| `FR-SEC-7` Machine unmodified | 7.1, 7.2, 7.3, 7.4 | — | — | — |

88% Critical, and the three Important entries are refinements of Critical ones. **Security is the tier where "can slip" is not available**, because every one of these is either a §24.5 gate or a `PROJECT_CONTEXT.md` §19 invariant.

### 4.12 Error Handling — 22

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-ERR-1` Message template | 1.1, 1.2 | 1.3, 1.4 | — | — |
| `FR-ERR-2` Blast radius | 2.1, 2.2 | 2.3 | — | — |
| `FR-ERR-3` Defined recovery | 3.1, 3.2 | 3.3 | — | — |
| `FR-ERR-4` Safe Mode | 4.1, 4.2, 4.3, 4.4, 4.5, 4.7 | 4.6 | — | — |
| `FR-ERR-5` Local diagnostics | 5.3, 5.5 | 5.1, 5.2, 5.4 | — | — |

`FR-ERR-4` is Critical in all but its startup budget. Safe Mode is what makes deep customization safe to attempt (`PROJECT_CONTEXT.md` §10.5) and `AC-ERR-4.1` — reachable from 100% of induced failure states — is a §24.5 gate.

### 4.13 Offline — 17

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-OFF-1` Core works offline | 1.1, 1.2, 1.3, 1.4 | — | — | — |
| `FR-OFF-2` Network enumerable | 2.1, 2.3 | 2.2 | — | — |
| `FR-OFF-3` Honest degradation | 3.3 | 3.1, 3.2, 3.4 | — | — |
| `FR-OFF-4` Update-check consent | 4.1, 4.2, 4.4, 4.5, 4.6 | 4.3 | — | — |

`AC-OFF-2.1` and `AC-OFF-4.6` are two statements of the same guarantee — zero outbound bytes by default — which `S-12` measures as release-blocking.

### 4.14 Data Persistence — 30

| Requirement | 🔴 Critical | 🟡 Important | 🔵 Optional | ⚪ Future |
| --- | --- | --- | --- | --- |
| `FR-DAT-1` Never silently lost | 1.1, 1.2, 1.3, 1.4 | 1.5 | — | — |
| `FR-DAT-2` Cache disposable | — | 2.1, 2.2, 2.3 | — | — |
| `FR-DAT-3` Per-user, no system writes | 3.1, 3.2 | 3.3 | 3.4 | — |
| `FR-DAT-4` Hand-editable | 4.3, 4.5 | 4.1, 4.2, 4.4 | — | — |
| `FR-DAT-5` Safe migration | 5.1, 5.2, 5.3 | 5.4 | — | — |
| `FR-DAT-6` Plugin storage isolated | 6.1, 6.4 | 6.2 | 6.3 | — |
| `FR-DAT-7` Uninstall complete | 7.1, 7.4, 7.5 | 7.2, 7.3 | — | — |

`AC-DAT-1.1` is the single most important criterion in the PRD: **no supported action changes an arrangement without a user action or a visible notice.** It carries `S-3`, which has no acceptable nonzero value.

---

## 5. The Minimum Usable V1

**The 212 Critical criteria are the minimum usable V1. There is no smaller set.**

That is the direct answer to "identify the minimum set required for a usable V1 release," and it is not a negotiating position — every one of the 212 satisfies a test in §2.1, and each test is either a frozen release condition, a zero-tolerance metric, or an architectural boundary.

### 5.1 What the Minimum Set Delivers

| Capability | Present in the minimum V1 |
| --- | --- |
| A good-looking populated desktop on first launch, with no prompts and no setup | ✅ |
| Add, place, resize, configure, and remove widgets by direct manipulation | ✅ |
| One theme restyling everything, including third-party surfaces | ✅ |
| Per-topology layouts that survive dock, undock, reboot, and update | ✅ |
| Correct rendering across mixed DPI and mixed refresh | ✅ |
| Install third-party plugins with narrow, revocable, plainly-stated grants | ✅ |
| A published SDK an external developer can ship against | ✅ |
| Keyboard operability of every core action | ✅ |
| WCAG 2.2 AA conformance | ✅ |
| Safe Mode reachable from any failure | ✅ |
| Zero network egress by default | ✅ |
| Clean uninstall leaving the machine unmodified | ✅ |

### 5.2 What the Minimum Set Omits

Present in the PRD, not in the minimum: live theme preview, widget duplication, widget locking, workspace duplication, settings search, snap-target visuals, aspect-ratio resize, shortcut default restoration, battery-mode idle tuning, and most individual performance thresholds (which remain Important, and remain *measured*).

**A V1 shipping exactly the Critical set is a coherent product, not a stripped one.** Nothing in the omitted list is load-bearing for `PS-1`…`PS-5`.

---

## 6. What "Can Slip" Actually Means

| Tier | Slips to | Carries a known-issue entry | Blocks release |
| --- | --- | --- | --- |
| 🟡 Important | V1.0.x patch | Yes | No |
| 🔵 Optional | V1.5 | No | No |
| ⚪ Future | Removed from V1 | N/A — cut before build | No |

**Two guardrails, because "can slip" degrades into "never ships" without them:**

1. **The 15-issue ceiling.** More than ~15 unmet Important criteria at release means the release is premature, regardless of Critical status. A product with 40 documented known issues has not shipped a V1; it has shipped a backlog.
2. **Slipping is a decision with a record.** An Important criterion is marked unmet in the release notes with a named owner and a target patch. It is not dropped by running out of time and not mentioning it.

---

## 7. Sequencing — Why Sprint 1 Is Not Impossible

212 Critical criteria is a **release scope**, not a sprint scope. The dependency graph in [`PRD.md`](./PRD.md) Appendix C forces most of the order; this section applies it.

### 7.1 Milestones

Counts are **derived from area composition**, not estimated. Each milestone's figure is the sum of the Critical criteria it consumes from §3.1, after M0 has taken its share.

| Milestone | Delivers | Composition | Critical | Stage |
| --- | --- | --- | --- | --- |
| **M0 — Walking skeleton** | The team can run DevDesk daily | itemized in §7.2 | **45** | 0–4 |
| **M1 — Multi-monitor truth** | Topology identity, per-topology layouts, full widget manipulation | `MON` 19 · `WGT` 11 · `DAT` 9 · `LAY` 5 | **44** | 2, 6 |
| **M2 — One visual system** | Theme engine, effects, degradation, first-run polish | `THM` 10 · `FRE` 7 | **17** | 5 |
| **M3 — The platform** | Plugin runtime, grants, SDK, settings, keyboard | `PLG` 27 · `SET` 8 · `KBD` 8 | **43** | 7 |
| **M4 — Assurance** | Accessibility, security, errors, offline, performance | `A11Y` 18 · `SEC` 20 · `ERR` 10 · `OFF` 9 · `PERF` 6 | **63** | 8 |
| | | | **212** | |

**M4 is the largest milestone, and that is correct.** Accessibility conformance, capability-bypass testing, error-message auditing, and budget measurement are release gates (PRD §24.5) that cannot be evaluated until the thing being gated exists. Planning as though M3 is the finish line is the single most likely way this schedule fails.

### 7.2 M0 — The Walking Skeleton

The smallest build the team can use daily. **Dogfooding starts here**, and it is what will surface the defects no specification predicts.

| Area | M0 Critical criteria |
| --- | --- |
| Persistence | `AC-DAT-1.1`, `1.2`, `1.3`, `3.1`, `3.2`, `4.3`, `4.5` |
| Layout | `AC-LAY-1.1`, `1.2`, `1.3`, `2.1`, `2.2` |
| Widgets | `AC-WGT-2.1`, `4.2`, `4.4`, `4.5`, `6.1`, `8.3`, `9.1`, `9.4` |
| First run | `AC-FRE-1.1`, `1.2`, `1.3`, `1.4`, `6.1`, `6.2`, `6.4` |
| Theme | `AC-THM-3.1`, `3.2`, `4.2` |
| Errors | `AC-ERR-2.2`, `4.2`, `4.4`, `4.5` |
| Keyboard | `AC-KBD-1.1`, `1.2`, `1.4`, `2.2` |
| Security | `AC-SEC-7.1`, `7.2`, `7.3` |
| Offline | `AC-OFF-1.1`, `1.4`, `2.1` |
| Performance | `AC-PERF-7.1` |

**45 criteria.** Two widgets, one theme, one monitor, drag-and-persist, Safe Mode, and a command registry that CI already enforces. That is a sprintable target.

**M0 is Sprint 1.** Its sub-classification into Foundation / Core UX / Security / Reliability, the crate and package initialization order, the commit sequence, and the slip rules are owned by [`planning/SPRINT_1.md`](../../planning/SPRINT_1.md) and are not duplicated here. This section owns *which* criteria are M0; that document owns *how they are built*.

**Why these and not others.** M0 deliberately includes `AC-KBD-1.1`/`1.2`/`1.4` (command coverage enforced in CI) and `AC-SEC-7.1`/`7.2`/`7.3` (no machine modification) even though neither is user-visible. Both are **retrofit-impossible**: adding command coverage after a hundred controls exist means auditing a hundred controls, and discovering a system-write dependency after Stage 6 means unpicking it from everything built on top. They cost almost nothing on day one and a rewrite on day ninety.

### 7.3 Sequencing Rules

1. **Never build ahead of the graph.** PRD Appendix C §D.2 names three edges whose violation costs a rebuild, not a refactor.
2. **A milestone is complete when its Critical criteria pass** — not when its features demo.
3. **Important criteria are built inside their milestone if there is room, and are never the reason a milestone slips.**
4. **Optional criteria are not scheduled.** They are picked up opportunistically or not at all.
5. **`Q-1` and `Q-2` must be resolved by ADR before M1 and M2 respectively** (PRD §25.2). Building either branch speculatively is waste.

---

## 8. Escalation and De-escalation

A tier is a claim about consequence, and claims can be wrong.

| Movement | Requires | Rationale |
| --- | --- | --- |
| Important → Critical | Product + Lead Architect | Evidence that its absence breaks a §2.1 test. `FR-KBD-7` has a pre-agreed trigger (§4.7) |
| Critical → Important | Product + Lead Architect + **the owner of the gate it serves** | The gate owner must confirm the gate survives without it. Security and accessibility de-escalations additionally require Security sign-off |
| Anything → Future | Product + Lead Architect + **a PRD amendment** | This is a scope cut, not a reclassification (§9) |
| Future → any tier | Product | Reinstating scope is cheaper than cutting it and needs no amendment |

**A Critical criterion is never de-escalated because it turned out to be expensive.** Cost changes sequencing (§7), not classification (§2.3). If a Critical criterion is genuinely unaffordable, the finding is that V1 scope is wrong, and `PROJECT_CONTEXT.md` §7.1 is frozen — so that finding needs an ADR, not a matrix edit.

---

## 9. Proposed Cuts — The `Future` Tier

These nine criteria are **recommended for removal from V1 scope.** Each requires a PRD amendment to actually cut; until amended, they remain in the PRD and are simply not scheduled.

| Criteria | What is cut | Why it can go | Cost of cutting |
| --- | --- | --- | --- |
| `AC-THM-2.1`, `2.2`, `2.3` | Live theme preview on focus | `FR-THM-3` (apply) plus `FR-THM-4` (revert in one action) covers the need — try it, undo it. Preview is a delight feature that adds a whole second application path through the token system | A theme is evaluated by applying rather than hovering. Minor |
| `AC-THM-1.2` | Previews generated from actual token values | A static author-supplied preview image is acceptable for V1 and costs nothing | A theme with a misleading preview image is possible. Detectable, low frequency |
| `AC-WGT-10.1`, `10.2` | Widget duplication | Adding a second instance from the library and configuring it achieves the same result in one extra step | Slightly slower for users running several instances of one widget |
| `AC-WGT-11.1` | Widget locking | Undo (`AC-WGT-9.1`) already protects against accidental change, which is what locking guards against | Users who arrange once and never want to touch it again lose a small comfort |
| `AC-LAY-4.3` | Workspace duplication | Creating a workspace and arranging it is the V1 path. Duplication is convenience over a rare action | Setting up a second similar workspace takes longer |
| `AC-SET-1.4` | Settings search | Nine fixed sections (`FR-SET-1`) is a small enough space to navigate directly | Slower for users who know a setting's name but not its section |

**Total saved: 9 criteria, roughly one requirement and change.** The saving is not primarily in build effort — it is in **avoiding a second interaction path through the theme system** (`FR-THM-2`), which is the largest single item here and the one most likely to produce subtle state bugs during a preview-then-cancel cycle.

**These are recommendations.** Rejecting any of them costs one milestone slot, not a redesign.

---

## 10. What This Document Does Not Change

Stated explicitly, because a prioritization document is the natural place for scope to leak.

| Unchanged | Why |
| --- | --- |
| `PROJECT_CONTEXT.md` §7.1 V1 must-haves | Frozen. Every one still ships |
| `PROJECT_CONTEXT.md` §7.2 V1 exclusions | Frozen. Nothing is promoted into V1 here |
| PRD §24 release criteria | Every gate stands; this document classifies criteria *within* those gates |
| The five origin frustrations `PS-1`…`PS-5` | All five remain release-gating and all five are fully covered by the Critical tier |
| Any success metric `S-1`…`S-15` | None is weakened. The zero-tolerance four (`S-3`, `S-10`, `S-12`, `S-15`) are entirely Critical |
| Requirement wording | This document reclassifies; it never rewords |

**No Critical criterion was made Critical by this document.** Each was already release-blocking by the PRD, the frozen scope, or an architectural boundary. This document made that visible; it did not make it true.

---

## 11. Reconciliation

| Check | Result |
| --- | --- |
| PRD requirements classified | 92 of 92 |
| PRD acceptance criteria classified | **380 of 380** |
| Criteria appearing in more than one tier | 0 |
| Criteria appearing in no tier | 0 |
| Tier totals | 212 + 137 + 22 + 9 = **380** ✅ |
| Area totals sum to 380 | ✅ (§3.1) |
| Milestone Critical totals sum to 212 | ✅ 45 + 44 + 17 + 43 + 63 (§7.1) |
| M0 itemized criteria match its stated count | ✅ 45 (§7.2) |

**Maintenance rule.** Adding a criterion to the PRD without classifying it here leaves this document invalid. The reconciliation above is the check — if the totals stop matching, the matrix is stale and must not be used for sprint planning until it is corrected.

---

## Related Documents

| Document | Relationship |
| --- | --- |
| [`PRD.md`](./PRD.md) | **Parent.** Owns every requirement and criterion. This document classifies them and adds nothing |
| [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md) 🔒 | Owns V1 scope (§7), success metrics (§27), and release conditions (§7.4) — the source of the §2.1 Critical tests |
| [`ADR-0002`](../adr/ADR-0002-performance-budgets.md) | Owns every performance threshold, and the amendment path that makes most `PERF` criteria Important rather than Critical |
| [`SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §25.1 | Owns the implementation stages §7.1 maps milestones onto |
| `PRD.md` Appendix C | Owns the dependency graph §7 sequences against |

---

**212 criteria block the release. 45 of them make the product usable enough to live in. Start there.**
