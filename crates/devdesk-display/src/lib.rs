//! Display topology: monitor identity, coordinate spaces, and DPI.
//!
//! Identity comes first, deliberately. Every layout guarantee downstream rests
//! on a monitor being recognisable across a reboot or a docking event, and a
//! layout system built on unstable identity reproduces `PS-3` at the schema
//! level — the origin failure, reintroduced by the thing meant to fix it.
//!
//! ## The pipeline
//!
//! ```text
//! PlatformBackend  →  Topology  →  DisplayGraph  →  consumers
//!   raw records       identity      spatial index
//!                     + geometry    (immutable)
//! ```
//!
//! Each stage is one direction and one responsibility. The backend says what the
//! system reported; [`enumerate`](enumerate::enumerate) turns that into a
//! [`Topology`] with resolved identity and space-tagged geometry; a
//! [`DisplayGraph`] is an immutable spatial index over one topology snapshot.
//! Nothing flows back up, and no consumer reaches past the graph to the backend.
//!
//! This crate owns **no window placement policy**. That is layout, owned by
//! `devdesk-core`. It answers what displays exist and where; nothing about what
//! should be drawn on them.
//!
//! Boundary: see `README.md`. Responsibilities are defined by
//! `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 and are not restated here.

pub mod enumerate;
pub mod error;
pub mod geometry;
pub mod graph;
pub mod hash;
pub mod identity;
pub mod monitor;
pub mod topology;

pub use enumerate::{enumerate, supports_stable_identity};
pub use error::DisplayError;
pub use geometry::{
    LogicalPoint, LogicalRect, LogicalSize, PhysicalPoint, PhysicalRect, PhysicalSize, ScaleFactor,
    SurfaceLocalPoint, SurfaceLocalRect, SurfaceLocalSize, SurfaceOrigin,
};
pub use graph::{Adjacency, Direction, DisplayGraph};
pub use identity::{IdentityConfidence, IdentityMatch, ModelId, MonitorId, MonitorIdentity};
pub use monitor::MonitorDescriptor;
pub use topology::{Topology, TopologyFingerprint};

#[cfg(test)]
mod tests;
