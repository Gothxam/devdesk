//! The two identities in the window subsystem, and why they are two.
//!
//! A surface and the host window carrying it are not the same thing and do not
//! live the same length of time. A surface survives a restart; the window that
//! renders it does not survive a reload. Collapsing them into one identifier
//! forces one of the two to be wrong.
//!
//! | | [`SurfaceId`] | [`WindowId`] |
//! | --- | --- | --- |
//! | Names | The composed thing the user arranged | The host window rendering it |
//! | Scope | Across sessions and machines | One process, one run |
//! | Assigned by | The caller — derived from plugin and instance | The manager, monotonically |
//! | Persisted | **Yes.** It is what a layout binds to | **No** |
//!
//! This is the same distinction `ADR-0004` `TP-14` draws between a topology
//! fingerprint and a generation, for the same reason: an identifier that crosses
//! the process boundary must survive a restart with its meaning intact, and a
//! counter does not.

use core::fmt;

use serde::{Deserialize, Serialize};

/// A surface's stable identity.
///
/// Persisted, because an arrangement is stored per surface and has to find the
/// same surface again on the next launch. In M0 the caller supplies it; from M3
/// it is derived from the plugin identifier and the instance number, which is
/// why it is an opaque string rather than a number the core hands out.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SurfaceId(String);

impl SurfaceId {
    /// Creates a surface identity.
    ///
    /// Returns `None` for an empty or whitespace-only value. An empty identity
    /// would be stored, looked up, and matched against another empty one — every
    /// unnamed surface would share one arrangement, which is the same class of
    /// defect as two displays agreeing on an absent serial (`ADR-0004` `MI-3`).
    #[must_use]
    pub fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        if value.trim().is_empty() {
            None
        } else {
            Some(Self(value))
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SurfaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A host window's identity within this process.
///
/// # Process-local; never persisted
///
/// It names a window that exists right now. Storing one would produce a value
/// that still *compares* on the next launch — window 3 from a previous run
/// against window 3 from this one — and a consumer restoring an arrangement
/// would address a window belonging to a process that no longer exists.
///
/// **The absence of `Serialize` and `Deserialize` here is deliberate and
/// load-bearing**, exactly as it is on
/// [`TopologyGeneration`](devdesk_display::TopologyGeneration). Arrangements are
/// keyed by [`SurfaceId`], which does derive them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WindowId(u64);

impl WindowId {
    /// The value handed out before any window exists.
    ///
    /// Never assigned to a real window: allocation starts at 1, so a zero here
    /// is an uninitialised field rather than a valid handle.
    pub const NONE: Self = Self(0);

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    #[must_use]
    pub const fn is_none(self) -> bool {
        self.0 == 0
    }
}

impl fmt::Display for WindowId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "window#{}", self.0)
    }
}

/// Hands out window identities in one process.
///
/// Monotonic and never reused. Reusing a retired id would let a command queued
/// for a destroyed window arrive at its replacement — the window equivalent of
/// a dangling pointer, and one that presents as a surface flickering on an
/// unrelated display.
#[derive(Debug, Default)]
pub struct WindowIdAllocator {
    next: u64,
}

impl WindowIdAllocator {
    #[must_use]
    pub const fn new() -> Self {
        Self { next: 0 }
    }

    /// The next unused identity.
    pub fn allocate(&mut self) -> WindowId {
        self.next = self.next.saturating_add(1);
        WindowId(self.next)
    }

    /// How many identities have been handed out.
    #[must_use]
    pub const fn issued(&self) -> u64 {
        self.next
    }
}
