# `@devdesk/effects`

**Published:** no (`private: true`)

## Owns

Glass, blur, shadow, and noise compositing primitives; GPU cost accounting; automatic degradation.

## Does not own

Layout. Effects decorate; they never position. `backdrop-filter` outside this package is prohibited (TH-6, AP-3).

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
