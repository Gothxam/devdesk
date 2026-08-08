//! The state kernel: single source of truth for all durable and shared state (B-2).
//!
//! Boundary: see `README.md`. Responsibilities are defined by
//! `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 and are not restated in code.

pub mod window;
