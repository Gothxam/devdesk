# DevDesk Project Constitution

## 📜 Core Mandate

DevDesk is a high-performance, modular desktop workspace environment designed for developer productivity.

## 🏛️ Fundamental Principles

1. **Modular First**: Every major capability is isolated inside decoupled packages (`packages/`), widgets (`widgets/`), or plugins (`plugins/`).
2. **Three Sources of Truth**:
   - `docs/` → Specifications (*What the system should do*)
   - `knowledge/` → Research & Notes (*What we've learned*)
   - `.ai/` → AI Agent Context (*How agents should operate*)
3. **No Direct Main Pushes**:
   - Workflow: `Idea` ➔ `Issue` ➔ `Branch` ➔ `PR` ➔ `Review` ➔ `Merge`.
4. **Mandatory ADRs**:
   - Every architectural modification requires an Architecture Decision Record in `docs/adr/ADR-XXXX-title.md`.
5. **Session Logging**:
   - Every AI agent interaction is recorded in `.ai/SESSION.md`.
