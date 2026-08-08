# `devdesk-display`

**Layer:** Rust core — platform · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

Monitor enumeration, the three coordinate spaces and conversions between them, DPI resolution, hotplug debouncing, topology identity and fingerprinting.

## Does not own

Window placement policy — that is layout, owned by `devdesk-core`.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
