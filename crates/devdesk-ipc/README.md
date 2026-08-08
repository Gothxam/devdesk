# `devdesk-ipc`

**Layer:** Rust core — contract · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

Command registry, argument validation, error envelope, contract version negotiation, and TypeScript codegen.

## Does not own

Business logic — commands are thin adapters onto `devdesk-core` (RS-8).

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
