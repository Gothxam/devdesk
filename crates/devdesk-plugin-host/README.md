# `devdesk-plugin-host`

**Layer:** Rust core — extension · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

Manifest parse and validation, signature verification, the capability gate, sandbox supervision, and the plugin lifecycle FSM.

## Does not own

Plugin *rendering* — surfaces render in the webview layer.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
