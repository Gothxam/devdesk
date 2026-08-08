# `@devdesk/widget-engine`

**Published:** no (`private: true`)

## Owns

Surface lifecycle, layout solving, placement, drag and resize orchestration, z-management.

## Does not own

Plugin trust decisions (core-side) or visual identity (theme-side).

## Entry point

`src/index.ts`. The `exports` map in `package.json` **is** the public surface (OW-4); deep imports are prohibited (DR-5, AP-4).

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.2 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules
