//! The window subsystem.
//!
//! ```text
//! DisplayGraph  →  WindowManager  →  SurfaceManager  →  reveal state
//!  (immutable)      which display     which surfaces     when visible
//! ```
//!
//! It owns **surface lifecycle, monitor association, reveal state, and window
//! visibility commands**. It owns no placement: no coordinate, no size, no
//! anchor, no snapping. That is the layout actor's, and the boundary is the one
//! `ADR-0004` §4.3 draws for the display subsystem, moved up one layer.
//!
//! Nothing here knows what Tauri is. The manager produces commands; `apps/desktop`
//! executes them. That separation is what makes the central invariant testable as
//! a property of a list of values rather than as an observation of a running
//! window:
//!
//! > **A surface MUST NOT become visible before its first frame is ready.**

pub mod event;
pub mod id;
pub mod manager;
pub mod reveal;
pub mod surface;

pub use event::{AssociationReason, WindowEvent};
pub use id::{SurfaceId, WindowId, WindowIdAllocator};
pub use manager::{ObserveError, WindowError, WindowManager};
pub use reveal::{RevealError, RevealOutcome, RevealState, RevealStateMachine, RevealStep};
pub use surface::{AssociationIntent, SurfaceError, SurfaceManager, SurfaceRecord};

#[cfg(test)]
mod tests;
