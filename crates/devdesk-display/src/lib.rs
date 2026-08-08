//! Display topology: monitor identity, coordinate spaces, and DPI.
//!
//! Identity comes first, deliberately. Every layout guarantee downstream rests
//! on a monitor being recognisable across a reboot or a docking event, and a
//! layout system built on unstable identity reproduces `PS-3` at the schema
//! level — the origin failure, reintroduced by the thing meant to fix it.
//!
//! This crate owns **no window placement policy**. That is layout, owned by
//! `devdesk-core`. It answers what displays exist and where; nothing about what
//! should be drawn on them.
//!
//! Boundary: see `README.md`. Responsibilities are defined by
//! `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 and are not restated here.

pub mod geometry;
pub mod monitor;
pub mod topology;

pub use geometry::{
    LogicalPoint, LogicalSize, PhysicalPoint, PhysicalRect, PhysicalSize, ScaleFactor,
};
pub use monitor::{MonitorDescriptor, MonitorId};
pub use topology::{Topology, TopologyFingerprint};

#[cfg(test)]
mod tests;
