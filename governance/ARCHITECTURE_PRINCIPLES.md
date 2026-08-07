# Architecture Principles & Abstraction Levels

## 📐 Three Levels of Abstraction

To ensure DevDesk remains clean, maintainable, and scalable as it grows from 10 widgets to 100+ plugins, we enforce a strict separation of concerns across three levels of abstraction:

### 📘 Level 1 — Vision *(Rarely Changes)*
- **Scope**: Why DevDesk exists, core philosophy, and long-term product direction.
- **Location**: `governance/PROJECT_CONSTITUTION.md`, `README.md`, `planning/future.md`.
- **Rule**: High-level vision is immutable without explicit consensus.

### 📙 Level 2 — Architecture *(Changes Occasionally)*
- **Scope**: Engine design, public APIs, module boundaries, subsystem contracts, and ADRs.
- **Location**: `docs/architecture/`, `docs/api/`, `docs/adr/`, `packages/plugin-sdk/`.
- **Rule**: Any architectural modification requires an ADR (`docs/adr/ADR-XXXX-title.md`) and formal issue proposal.

### 📗 Level 3 — Implementation *(Changes Frequently)*
- **Scope**: Source code, component logic, configuration files, test suites, and build automation scripts.
- **Location**: `apps/`, `packages/`, `widgets/`, `plugins/`, `configs/`, `scripts/`, `tests/`.
- **Rule**: Code changes must strictly adhere to the contract established in Level 2 without leaking implementation details into Level 1 or 2.

---

## 🏗️ Core Pillars

1. **Performance & Efficiency**:
   - Zero unnecessary re-renders or main-thread blockages.
   - Heavy tasks run in Rust/Tauri background processes or worker threads.

2. **Strict Decoupling**:
   - UI (`packages/ui`) is decoupled from rendering engines (`packages/widget-engine`, `packages/theme-engine`).
   - Plugins run in isolated sandboxes using `packages/plugin-sdk`.

3. **Playground Prototyping**:
   - Experimental UI spikes live in `playground/` until validated. Production codebase is untouched during experimentation.

4. **Zero Documentation Bloat**:
   - Specs live in `docs/`, research in `knowledge/`, and agent guidance in `.ai/`.
