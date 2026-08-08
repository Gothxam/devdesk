# `devdesk-platform`

**Layer:** Rust core — platform · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

The `PlatformBackend` trait and its per-OS implementations. The *only* crate permitted `#[cfg(target_os)]` at API granularity (DR-6).

## Does not own

Policy decisions. It exposes capability; it does not decide when to use it.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
