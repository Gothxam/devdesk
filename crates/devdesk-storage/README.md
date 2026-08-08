# `devdesk-storage`

**Layer:** Rust core — persistence · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

SQLite schema and migrations, layered config resolution, atomic writes, backup and restore.

## Does not own

Domain semantics of what is stored.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
