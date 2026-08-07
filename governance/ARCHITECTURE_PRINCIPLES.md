# Architecture Principles

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
