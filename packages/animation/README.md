# `@devdesk/animation`

**Published:** no (`private: true`)

## Owns

Motion primitives, spring and easing catalogue, and `prefers-reduced-motion` enforcement.

## Does not own

Ad-hoc interval animation. RAF ownership is centralised here.

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
