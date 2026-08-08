# `@devdesk/contracts`

**Published:** **yes** — permanent compatibility obligation (ADR-0003 PK-1, PK-4)

## Owns

The generated IPC contract types (`src/generated/`, GEN-1) and the schema homes for plugin manifests, themes, and layouts.

## Does not own

Hand-written mirrors of generated types (AP-13). **Ratification pending ADR-0014** — see planning/SPRINT_1.md §3.1.

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
