# `@devdesk/theme-engine`

**Published:** no (`private: true`)

## Owns

Token graph resolution, cascade, custom-property emission, and theme switching.

## Does not own

Component styling decisions. Visual opinions live in themes, not the engine (D-8).

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
