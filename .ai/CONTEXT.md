# DevDesk - Project Context & Governance

## 🎯 Repository Design Philosophy: Three Sources of Truth

To keep DevDesk clean, modular, and maintainable without becoming documentation-heavy, the repository is divided into three distinct sources of truth:

1. **`docs/` → Specifications (What the system should do)**
   - Functional & technical specifications
   - System architecture specs, API designs, SDK definitions, ADRs (Architectural Decision Records)
   - Product requirements & design rules

2. **`knowledge/` → Research & Notes (What we've learned)**
   - Benchmark results, technical spikes, and research notes
   - Technology-specific learnings (Tauri, Rust, Windows, React, Glassmorphism, Rendering)
   - Architectural experiments and performance insights

3. **`.ai/` → AI Agent Guidance & Context (How agents should work)**
   - AI agent prompts, system context, rule definitions, decision logs, and code review criteria
   - Kept strictly separate so agent context does not clutter core product specifications or codebase docs

---

## 🏗️ Structure Overview

```text
devdesk/
├── docs/            # Specifications (System design & specs)
├── knowledge/       # Research & Notes (Learnings & spikes)
├── .ai/             # AI Guidance (Agent rules & instructions)
├── apps/            # Applications
├── packages/        # Shared core packages
├── widgets/         # UI Widgets & modules
├── plugins/         # Extensible plugin system
├── themes/          # Visual design systems & styles
├── assets/          # Static branding & visual assets
├── scripts/         # Automation & build scripts
├── examples/        # Reference usage & demos
├── tools/           # Internal developer tools
└── tests/           # Integration & E2E test suites
```
