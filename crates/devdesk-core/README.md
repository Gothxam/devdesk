# `devdesk-core`

**Layer:** Rust core — kernel · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

The authoritative application state graph, actor supervision, the event bus, and transaction/journal semantics.

## Does not own

Any OS API call, any serialization format, any UI concept.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
