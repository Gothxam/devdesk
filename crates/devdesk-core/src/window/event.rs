//! What the window subsystem says about its own state.
//!
//! A [`WindowEvent`] is a **statement of fact**: it describes something that has
//! already happened to the manager's state. Nobody has to act on one, and
//! ignoring one cannot corrupt anything.
//!
//! Requests to the host — create this window, show it — are a separate
//! vocabulary arriving with hidden surface creation. Keeping the two apart is
//! what keeps this crate free of Tauri: the manager decides *what should be
//! true* and has no idea what a webview is.

use devdesk_display::{TopologyFingerprint, TopologyGeneration};

/// Something that has happened to the window subsystem's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowEvent {
    /// A new topology was adopted.
    ///
    /// Carries the fingerprint as well as the generation because they answer
    /// different questions and a consumer usually needs both: the fingerprint to
    /// look up a stored arrangement (`WD-4`), the generation to tell whether
    /// work it is holding is stale (`ADR-0004` `TP-7`). `TP-14` forbids storing
    /// the generation; it is here to be compared within this process and
    /// discarded.
    TopologyAdopted {
        generation: TopologyGeneration,
        fingerprint: TopologyFingerprint,
        monitors: usize,
    },
}
