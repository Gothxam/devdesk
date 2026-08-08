# `@devdesk/storage`

**Published:** no (`private: true`)

## Owns

Typed client over storage commands, optimistic cache, and schema-versioned accessors.

## Does not own

Direct `invoke` calls from feature code — all persistence funnels here (TSG-8).

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
