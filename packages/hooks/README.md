# `@devdesk/hooks`

**Published:** no (`private: true`)

## Owns

React bindings to core state, subscription lifecycle, and selector-level updates.

## Does not own

Business logic. Hooks project state; they do not compute it.

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
