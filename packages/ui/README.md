# `@devdesk/ui`

**Published:** no (`private: true`)

## Owns

Accessible primitives and composites, fully token-driven.

## Does not own

Domain knowledge. No component may know what a plugin is.

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
