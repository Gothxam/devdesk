# DevDesk Implementation & Governance Rules

## 🛡️ Repository Rules

1. **Strict Git Workflow**:
   ```text
   Issue ➔ Branch ➔ PR ➔ Review ➔ Merge
   ```
   - **NEVER** push features directly to `main`, even when working solo.

2. **Architecture Decision Records (ADR)**:
   - Any architectural modification **MUST** include an ADR in `docs/adr/ADR-XXXX-title.md`. No exceptions.

3. **DevDesk Feature Lifecycle**:
   ```text
   Idea ➔ Discussion ➔ ADR ➔ Implementation ➔ Review ➔ Merge
   ```

4. **Three Levels of Abstraction**:
   - **📘 Level 1 — Vision** (*Rarely changes*): Why DevDesk exists, core philosophy. (`governance/`, `README.md`)
   - **📙 Level 2 — Architecture** (*Changes occasionally*): Engines, APIs, contracts, module boundaries. (`docs/architecture/`, `docs/adr/`, `packages/plugin-sdk/`)
   - **📗 Level 3 — Implementation** (*Changes frequently*): Source code, configs, tests, scripts. (`apps/`, `packages/`, `widgets/`, `plugins/`, `configs/`)
   - **Rule**: Never mix these three levels. Implementation details must not pollute Level 1 or Level 2 documents.

5. **AI Session Goldmine (`.ai/SESSION.md`)**:
   - Every AI agent interaction must append a record to `.ai/SESSION.md` containing:
     - Date
     - Agent Name & System
     - Task Description
     - Files Changed
     - Decisions Made
     - Next Steps

6. **Sandbox & Playground Isolation**:
   - Experimental prototypes live in `playground/`.
   - Never clutter production code with experimental spikes.
