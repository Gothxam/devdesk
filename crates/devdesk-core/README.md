# `devdesk-core`

**Layer:** Rust core — kernel · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

The authoritative application state graph, actor supervision, the event bus, and transaction/journal semantics.

### Window subsystem (`src/window/`)

Surface lifecycle, monitor association, reveal state, and the window visibility
commands the host executes. It is the core's single consumer of
`devdesk-display` (`ADR-0004` `ARCH-1`) — nothing else in the window or layout
path reaches back to the display crate or to a `PlatformBackend`.

## Does not own

Any OS API call, any serialization format, any UI concept.

Window placement. The window subsystem answers *which display* a surface belongs
to; it computes no coordinate, size, or anchor, and it holds no snapping,
z-order, or layer policy. That boundary is `ADR-0004` §4.3, moved up one layer.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
