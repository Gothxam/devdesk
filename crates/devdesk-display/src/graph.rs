//! An immutable spatial index over one topology snapshot.
//!
//! ## Immutability is the design, not a detail
//!
//! A graph is built once from an `Arc<Topology>` and never changes. There is no
//! `&mut self` method, no interior mutability, and no way to add or move a
//! monitor after construction. **Every topology change produces a new graph.**
//!
//! The reason is that spatial queries are asked in the middle of other work — a
//! drag in progress, a layout being solved, a hit test on a click. A graph that
//! could change under a caller would let a sequence of queries answer against
//! two different desktops, and the result is a surface placed by two monitors
//! that never coexisted. Immutability makes that impossible to express rather
//! than merely unlikely: a caller holding an `Arc<DisplayGraph>` has a desktop
//! that is internally consistent for as long as it holds it, even while a newer
//! one is being published.
//!
//! Rebuilding rather than mutating costs one allocation per topology change,
//! which happens on hotplug and never in a frame. See the `topology` bench.
//!
//! ## What it does not own
//!
//! Placement. Every query here answers a question about *where the displays
//! are* — which one contains this point, which one is to the left, do they form
//! one region. None of them answers where a surface should go. That is layout,
//! owned by `devdesk-core`, and a `clamp_into_bounds` helper on this type would
//! be the first line of it.

use std::sync::Arc;

use crate::geometry::{PhysicalPoint, PhysicalRect};
use crate::identity::MonitorId;
use crate::monitor::MonitorDescriptor;
use crate::topology::{Topology, TopologyFingerprint};

/// A direction between two adjacent displays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    Left,
    Right,
    Above,
    Below,
}

impl Direction {
    /// The direction pointing back the other way.
    #[must_use]
    pub const fn opposite(self) -> Self {
        match self {
            Self::Left => Self::Right,
            Self::Right => Self::Left,
            Self::Above => Self::Below,
            Self::Below => Self::Above,
        }
    }
}

/// One display's neighbour in a given direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Adjacency {
    /// Index into the graph's monitors.
    index: usize,
    /// Where the neighbour is, relative to the display it is a neighbour of.
    direction: Direction,
    /// How much of the shared edge the two displays have in common, in pixels.
    ///
    /// Carried because "adjacent" is not one thing: two 1080p displays stacked
    /// flush share 1920 pixels of edge, while one nudged down by all but a pixel
    /// shares one. A caller deciding whether a direction is worth navigating
    /// needs to tell those apart.
    shared_edge: u32,
}

impl Adjacency {
    #[must_use]
    pub const fn direction(&self) -> Direction {
        self.direction
    }

    #[must_use]
    pub const fn shared_edge(&self) -> u32 {
        self.shared_edge
    }
}

/// An immutable spatial index over one arrangement.
#[derive(Debug)]
pub struct DisplayGraph {
    topology: Arc<Topology>,
    /// Adjacency lists, parallel to `topology.monitors()`.
    edges: Vec<Vec<Adjacency>>,
    /// The union of every display's bounds. `None` when nothing is attached.
    virtual_bounds: Option<PhysicalRect>,
    fingerprint: TopologyFingerprint,
}

impl DisplayGraph {
    /// Builds a graph over a topology snapshot.
    ///
    /// Takes an `Arc` rather than a `Topology`: the same snapshot is shared by
    /// the transaction that published it and by every consumer that read it,
    /// and copying it per consumer would make "the current topology" a set of
    /// equal-but-separate values that can silently drift apart.
    #[must_use]
    pub fn build(topology: Arc<Topology>) -> Arc<Self> {
        let monitors = topology.monitors();

        let mut edges = vec![Vec::new(); monitors.len()];
        for (index, monitor) in monitors.iter().enumerate() {
            for (other_index, other) in monitors.iter().enumerate() {
                if index == other_index {
                    continue;
                }
                if let Some((direction, shared_edge)) = abutment(&monitor.bounds, &other.bounds) {
                    edges[index].push(Adjacency {
                        index: other_index,
                        direction,
                        shared_edge,
                    });
                }
            }
        }

        let virtual_bounds = monitors
            .iter()
            .map(|monitor| monitor.bounds)
            .reduce(|left, right| left.union(&right));

        let fingerprint = topology.fingerprint();

        Arc::new(Self {
            topology,
            edges,
            virtual_bounds,
            fingerprint,
        })
    }

    /// The snapshot this graph indexes.
    #[must_use]
    pub fn topology(&self) -> &Arc<Topology> {
        &self.topology
    }

    /// The displays, in stable identity order.
    #[must_use]
    pub fn monitors(&self) -> &[MonitorDescriptor] {
        self.topology.monitors()
    }

    /// The fingerprint of the arrangement this graph indexes.
    ///
    /// Computed once at build time. It is asked for on every layout lookup
    /// (WD-4) and the answer cannot change, so recomputing it per call would be
    /// work performed to arrive at a value already known.
    #[must_use]
    pub const fn fingerprint(&self) -> &TopologyFingerprint {
        &self.fingerprint
    }

    /// The rectangle spanning every attached display.
    ///
    /// `None` when nothing is attached — which is a real state, not an error: a
    /// laptop with the lid closed and nothing plugged in reports exactly that.
    #[must_use]
    pub const fn virtual_bounds(&self) -> Option<PhysicalRect> {
        self.virtual_bounds
    }

    /// The primary display, if the platform named one.
    #[must_use]
    pub fn primary(&self) -> Option<&MonitorDescriptor> {
        self.topology.primary()
    }

    /// Finds a display by identity.
    #[must_use]
    pub fn find(&self, id: &MonitorId) -> Option<&MonitorDescriptor> {
        self.topology.find(id)
    }

    /// The display containing a point.
    ///
    /// `None` for a point in a gap between displays, which is reachable: Windows
    /// permits arrangements with unfilled space between monitors, and a cursor
    /// cannot be there but a stored surface position can.
    #[must_use]
    pub fn monitor_at(&self, point: PhysicalPoint) -> Option<&MonitorDescriptor> {
        self.monitors()
            .iter()
            .find(|monitor| monitor.bounds.contains(point))
    }

    /// The display nearest a point, by squared distance to its bounds.
    ///
    /// Zero distance means the point is inside, so this agrees with
    /// [`DisplayGraph::monitor_at`] wherever that answers. Ties break toward the
    /// earlier display in identity order, which is stable across enumeration
    /// changes — breaking them by enumeration order would make the answer depend
    /// on the thing WD-3 exists to stop depending on.
    #[must_use]
    pub fn nearest(&self, point: PhysicalPoint) -> Option<&MonitorDescriptor> {
        self.monitors()
            .iter()
            .min_by_key(|monitor| squared_distance(&monitor.bounds, point))
    }

    /// The displays a rectangle overlaps.
    #[must_use]
    pub fn monitors_intersecting(&self, rect: &PhysicalRect) -> Vec<&MonitorDescriptor> {
        self.monitors()
            .iter()
            .filter(|monitor| monitor.bounds.intersects(rect))
            .collect()
    }

    /// The display that fully contains a rectangle, if one does.
    ///
    /// A rectangle straddling two displays belongs to neither, and saying so is
    /// the point: the caller then decides what that means, rather than being
    /// handed whichever display happened to be enumerated first.
    #[must_use]
    pub fn monitor_containing(&self, rect: &PhysicalRect) -> Option<&MonitorDescriptor> {
        self.monitors()
            .iter()
            .find(|monitor| monitor.bounds.contains_rect(rect))
    }

    /// Everything adjacent to a display.
    #[must_use]
    pub fn adjacencies(&self, id: &MonitorId) -> Vec<(Adjacency, &MonitorDescriptor)> {
        let Some(index) = self.index_of(id) else {
            return Vec::new();
        };

        self.edges[index]
            .iter()
            .filter_map(|edge| {
                self.monitors()
                    .get(edge.index)
                    .map(|monitor| (*edge, monitor))
            })
            .collect()
    }

    /// The display adjacent to another in a given direction.
    ///
    /// Adjacency means the two displays' edges *touch*. A display across a gap
    /// is not a neighbour here, because deciding whether a gap is small enough
    /// to step across is a navigation policy and this type holds none. Where
    /// several displays abut in one direction, the one sharing the longest edge
    /// wins.
    #[must_use]
    pub fn neighbor(&self, id: &MonitorId, direction: Direction) -> Option<&MonitorDescriptor> {
        let index = self.index_of(id)?;

        self.edges[index]
            .iter()
            .filter(|edge| edge.direction == direction)
            .max_by_key(|edge| edge.shared_edge)
            .and_then(|edge| self.monitors().get(edge.index))
    }

    /// Whether every display touches at least one other.
    ///
    /// A desktop can legitimately be discontiguous — a display island across a
    /// gap is a supported Windows arrangement — and a caller that assumed
    /// otherwise would compute a navigation order that cannot reach part of the
    /// desktop.
    #[must_use]
    pub fn is_contiguous(&self) -> bool {
        match self.monitors().len() {
            0 | 1 => true,
            count => {
                // Breadth-first from the first display; contiguous exactly when
                // every display is reachable.
                let mut seen = vec![false; count];
                let mut queue = vec![0usize];
                seen[0] = true;
                let mut reached = 1usize;

                while let Some(index) = queue.pop() {
                    for edge in &self.edges[index] {
                        if !seen[edge.index] {
                            seen[edge.index] = true;
                            reached += 1;
                            queue.push(edge.index);
                        }
                    }
                }

                reached == count
            }
        }
    }

    fn index_of(&self, id: &MonitorId) -> Option<usize> {
        self.monitors()
            .iter()
            .position(|monitor| monitor.id() == id)
    }
}

/// Whether two rectangles touch, and along how much of their shared edge.
///
/// Returns where `other` sits relative to `subject`. Overlapping rectangles —
/// two displays mirrored to the same origin — are not adjacent: there is no
/// direction to travel between them, and reporting one would send a navigation
/// step to a display already under the cursor.
fn abutment(subject: &PhysicalRect, other: &PhysicalRect) -> Option<(Direction, u32)> {
    if subject.intersects(other) {
        return None;
    }

    let vertical_overlap = overlap(
        subject.origin.y,
        subject.bottom(),
        other.origin.y,
        other.bottom(),
    );
    let horizontal_overlap = overlap(
        subject.origin.x,
        subject.right(),
        other.origin.x,
        other.right(),
    );

    if vertical_overlap > 0 {
        if other.right() == subject.origin.x {
            return Some((Direction::Left, vertical_overlap));
        }
        if other.origin.x == subject.right() {
            return Some((Direction::Right, vertical_overlap));
        }
    }

    if horizontal_overlap > 0 {
        if other.bottom() == subject.origin.y {
            return Some((Direction::Above, horizontal_overlap));
        }
        if other.origin.y == subject.bottom() {
            return Some((Direction::Below, horizontal_overlap));
        }
    }

    None
}

/// How much two half-open ranges have in common.
fn overlap(start: i32, end: i32, other_start: i32, other_end: i32) -> u32 {
    let low = start.max(other_start);
    let high = end.min(other_end);
    if high <= low {
        0
    } else {
        high.saturating_sub(low).unsigned_abs()
    }
}

/// Squared distance from a point to a rectangle; zero when inside.
///
/// Squared to keep the comparison in integers: a square root introduces a
/// floating-point comparison into a tie-break, and two displays exactly
/// equidistant would then resolve by rounding error.
fn squared_distance(rect: &PhysicalRect, point: PhysicalPoint) -> i64 {
    let dx = axis_distance(point.x, rect.origin.x, rect.right());
    let dy = axis_distance(point.y, rect.origin.y, rect.bottom());
    dx * dx + dy * dy
}

fn axis_distance(value: i32, low: i32, high: i32) -> i64 {
    if value < low {
        i64::from(low) - i64::from(value)
    } else if value >= high {
        i64::from(value) - i64::from(high) + 1
    } else {
        0
    }
}
