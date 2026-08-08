// Tauri isolation hook. Every message from a surface to the core passes through
// here before reaching the IPC bridge (SEC-6).
//
// Sprint 1 passes messages through unmodified. Payload validation lives in Rust
// at the capability gate (SEC-1) — a check performed in the same trust domain as
// the code being checked is not a check, so this hook never becomes the
// authorization point.
window.__TAURI_ISOLATION_HOOK__ = (payload) => payload;
