# `@devdesk/plugin-sdk`

**Published:** **yes** — permanent compatibility obligation (ADR-0003 PK-1, PK-4)

## Owns

The public, frozen author-facing contract; host API proxy; typed manifest helpers.

## Does not own

Any dependency on `ui`, `widget-engine`, or app internals. DR-4 currently permits `shared` only — the `contracts` dependency requires ADR-0014.

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
