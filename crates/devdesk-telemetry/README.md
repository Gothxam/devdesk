# `devdesk-telemetry`

**Layer:** Rust core — internal infrastructure · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

`tracing` subscriber wiring, span taxonomy, metric registry, bounded ring buffer, crash capture.

## Does not own

Network transmission of any kind (SEC-18). **No public API, no plugin access, no frontend dependency** — see `planning/SPRINT_1.md` §2.1 rules T-1…T-4.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
