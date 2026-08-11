//! Which host windows the desktop needs, and when.
//!
//! `ADR-0005` `DH-13`: **one host window per monitor**, each sized to that
//! monitor's bounds — not one window spanning the virtual desktop. Per-monitor
//! DPI (`WD-2`) makes a spanning window wrong on a mixed-DPI desk, and unplugging
//! a monitor should destroy exactly its own window rather than resize a shared
//! one.
//!
//! Everything here is a decision, not an action. It takes a topology and the set
//! of host windows that currently exist and says what should change; the caller
//! creates, moves, and destroys windows and reports back. That split is why the
//! multi-monitor and Explorer-restart behaviour can be tested on a machine with
//! one display and a running shell.
//!
//! Nothing in this module touches Tauri or Win32 (`DR-6`). It does name the
//! z-order bands from `devdesk-platform`, which are a portable enum: deciding
//! *which* band edit mode uses is desktop policy, and policy belongs here rather
//! than in the Tauri shell DR-7 keeps thin.

mod interaction;
mod mode;
mod plan;
mod recovery;

#[cfg(test)]
mod tests;

pub use interaction::{InteractionMode, InteractionSource};
pub use mode::{DesktopMode, ModeRequest, MODE_ENV_VAR};
pub use plan::{HostPlan, HostWindow, HostWindowChange, HostWindowId};
pub use recovery::{
    backoff_for, ReattachTrigger, RecoveryClock, RecoveryState, MAX_ATTEMPTS, MAX_BACKOFF,
    RECOVERY_DEBOUNCE,
};
