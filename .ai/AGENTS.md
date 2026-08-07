# AI Agent Guidelines for DevDesk

## 💡 core Principles

1. **Respect the Three Sources of Truth**:
   - Write product & architecture specifications in `docs/`.
   - Store research, spikes, and technical findings in `knowledge/`.
   - Keep AI prompts, rules, and governance context inside `.ai/`.

2. **Lean Documentation**:
   - Avoid creating redundant or overly verbose documentation files.
   - Specs in `docs/` should be concise, structured, and actionable.
   - Keep research in `knowledge/` decoupled from implementation files so it doesn't get outdated.

3. **Code & Architecture Integrity**:
   - Follow workspace modularity (`apps/`, `packages/`, `widgets/`, `plugins/`, `themes/`).
   - Keep code decoupled, well-typed, and maintainable.
