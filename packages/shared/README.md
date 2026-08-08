# `@devdesk/shared`

**Published:** **yes** — permanent compatibility obligation (ADR-0003 PK-1, PK-4)

## Owns

Branded ID types, `Result`, type guards, and zero-runtime-dependency utilities.

## Does not own

React, DOM, or Tauri imports — this package MUST be environment-agnostic (DR-3). A runtime dependency added here becomes a transitive dependency of every plugin ever written (PK-5).

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
