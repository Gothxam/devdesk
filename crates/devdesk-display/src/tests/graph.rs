//! The immutable spatial index.

use std::sync::Arc;

use crate::geometry::{PhysicalPoint, PhysicalSize};
use crate::graph::{Direction, DisplayGraph};
use crate::topology::Topology;

use super::fixtures::{identified, rect};

/// Two 1080p displays side by side, the left one primary.
fn side_by_side() -> Arc<DisplayGraph> {
    let left = identified(0, "SN-L")
        .bounds(0, 0, 1920, 1080)
        .primary(true)
        .build();
    let right = identified(1, "SN-R")
        .bounds(1920, 0, 1920, 1080)
        .primary(false)
        .build();

    DisplayGraph::build(Arc::new(Topology::new(vec![left, right])))
}

#[test]
fn a_point_resolves_to_the_display_containing_it() {
    let graph = side_by_side();

    let left = graph
        .monitor_at(PhysicalPoint { x: 10, y: 10 })
        .expect("inside the left display");
    let right = graph
        .monitor_at(PhysicalPoint { x: 2000, y: 10 })
        .expect("inside the right display");

    assert_eq!(left.identity.serial(), Some("SN-L"));
    assert_eq!(right.identity.serial(), Some("SN-R"));
}

#[test]
fn the_shared_edge_belongs_to_exactly_one_display() {
    // Inclusive bounds would put x = 1920 on both displays, and a hit test would
    // then depend on iteration order.
    let graph = side_by_side();
    let matches = graph
        .monitors()
        .iter()
        .filter(|monitor| monitor.bounds.contains(PhysicalPoint { x: 1920, y: 0 }))
        .count();

    assert_eq!(matches, 1);
}

#[test]
fn a_point_in_a_gap_belongs_to_no_display_but_has_a_nearest_one() {
    // Windows permits arrangements with unfilled space between monitors. A
    // cursor cannot be there, but a stored surface position can.
    let left = identified(0, "SN-L").bounds(0, 0, 1920, 1080).build();
    let island = identified(1, "SN-I").bounds(3000, 0, 1920, 1080).build();
    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![left, island])));

    let in_the_gap = PhysicalPoint { x: 2500, y: 500 };
    assert!(graph.monitor_at(in_the_gap).is_none());

    let nearest = graph.nearest(in_the_gap).expect("a nearest display exists");
    assert_eq!(nearest.identity.serial(), Some("SN-I"));
}

#[test]
fn nearest_agrees_with_containment_wherever_containment_answers() {
    let graph = side_by_side();
    let inside = PhysicalPoint { x: 2000, y: 500 };

    assert_eq!(
        graph.monitor_at(inside).map(|m| m.id()),
        graph.nearest(inside).map(|m| m.id())
    );
}

#[test]
fn adjacent_displays_know_which_way_the_other_lies() {
    let graph = side_by_side();
    let left = graph.monitors()[0].clone();
    let right = graph.monitors()[1].clone();

    let (left_id, right_id) = if left.identity.serial() == Some("SN-L") {
        (left.id().clone(), right.id().clone())
    } else {
        (right.id().clone(), left.id().clone())
    };

    assert_eq!(
        graph
            .neighbor(&left_id, Direction::Right)
            .map(|m| m.id().clone()),
        Some(right_id.clone())
    );
    assert_eq!(
        graph
            .neighbor(&right_id, Direction::Left)
            .map(|m| m.id().clone()),
        Some(left_id)
    );
    assert!(graph.neighbor(&right_id, Direction::Right).is_none());
}

#[test]
fn adjacency_carries_how_much_edge_is_shared() {
    // Two displays flush share their whole edge; one nudged down shares less.
    let top = identified(0, "SN-T").bounds(0, 0, 1920, 1080).build();
    let below = identified(1, "SN-B").bounds(960, 1080, 1920, 1080).build();
    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![top.clone(), below])));

    let edges = graph.adjacencies(top.id());
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].0.direction(), Direction::Below);
    assert_eq!(edges[0].0.shared_edge(), 960);
}

#[test]
fn mirrored_displays_are_not_adjacent() {
    // Two displays at the same origin overlap. There is no direction to travel
    // between them, and reporting one would send a navigation step to a display
    // already under the cursor.
    let a = identified(0, "SN-A").bounds(0, 0, 1920, 1080).build();
    let b = identified(1, "SN-B").bounds(0, 0, 1920, 1080).build();
    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![a.clone(), b])));

    assert!(graph.adjacencies(a.id()).is_empty());
}

#[test]
fn a_display_across_a_gap_is_not_a_neighbour() {
    // Deciding whether a gap is small enough to step across is navigation
    // policy, and this type holds none.
    let left = identified(0, "SN-L").bounds(0, 0, 1920, 1080).build();
    let island = identified(1, "SN-I").bounds(2000, 0, 1920, 1080).build();
    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![left.clone(), island])));

    assert!(graph.neighbor(left.id(), Direction::Right).is_none());
    assert!(!graph.is_contiguous());
}

#[test]
fn a_contiguous_desktop_reports_itself_as_one() {
    assert!(side_by_side().is_contiguous());

    let alone = DisplayGraph::build(Arc::new(Topology::new(vec![identified(0, "SN-A").build()])));
    assert!(alone.is_contiguous());

    let none = DisplayGraph::build(Arc::new(Topology::new(vec![])));
    assert!(none.is_contiguous());
}

#[test]
fn contiguity_follows_a_chain_rather_than_only_direct_neighbours() {
    let a = identified(0, "SN-A").bounds(0, 0, 1920, 1080).build();
    let b = identified(1, "SN-B").bounds(1920, 0, 1920, 1080).build();
    let c = identified(2, "SN-C").bounds(3840, 0, 1920, 1080).build();

    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![a.clone(), b, c.clone()])));

    assert!(graph.neighbor(a.id(), Direction::Right).is_some());
    assert!(graph.adjacencies(a.id()).len() == 1);
    assert!(graph.is_contiguous(), "A touches B touches C");
}

#[test]
fn virtual_bounds_span_every_display() {
    let left = identified(0, "SN-L").bounds(-1920, 0, 1920, 1080).build();
    let right = identified(1, "SN-R").bounds(0, 0, 2560, 1440).build();
    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![left, right])));

    let bounds = graph.virtual_bounds().expect("two displays are attached");
    assert_eq!(bounds.origin, PhysicalPoint { x: -1920, y: 0 });
    assert_eq!(
        bounds.size,
        PhysicalSize {
            width: 4480,
            height: 1440
        }
    );
}

#[test]
fn no_displays_means_no_virtual_bounds() {
    let graph = DisplayGraph::build(Arc::new(Topology::new(vec![])));
    assert!(graph.virtual_bounds().is_none());
    assert!(graph.nearest(PhysicalPoint { x: 0, y: 0 }).is_none());
    assert!(graph.primary().is_none());
}

#[test]
fn a_rectangle_straddling_two_displays_is_contained_by_neither() {
    // Saying so is the point: the caller decides what that means, rather than
    // being handed whichever display was enumerated first.
    let graph = side_by_side();
    let straddling = rect(1800, 100, 400, 200);

    assert!(graph.monitor_containing(&straddling).is_none());
    assert_eq!(graph.monitors_intersecting(&straddling).len(), 2);

    let inside = rect(100, 100, 400, 200);
    assert!(graph.monitor_containing(&inside).is_some());
    assert_eq!(graph.monitors_intersecting(&inside).len(), 1);
}

#[test]
fn a_graph_holds_its_snapshot_after_a_newer_one_is_built() {
    // The guarantee the whole type exists for: a caller mid-drag keeps querying
    // one internally consistent desktop even as a newer one is published.
    let before = side_by_side();
    let before_fingerprint = before.fingerprint().clone();

    let undocked = DisplayGraph::build(Arc::new(Topology::new(vec![identified(0, "SN-L")
        .bounds(0, 0, 1920, 1080)
        .primary(true)
        .build()])));

    assert_eq!(before.monitors().len(), 2);
    assert_eq!(undocked.monitors().len(), 1);
    assert_eq!(before.fingerprint(), &before_fingerprint);
    assert_ne!(before.fingerprint(), undocked.fingerprint());
}

#[test]
fn the_snapshot_is_shared_rather_than_copied_per_consumer() {
    // Copying the topology per consumer would make "the current topology" a set
    // of equal-but-separate values that can drift apart.
    let topology = Arc::new(Topology::new(vec![identified(0, "SN-A").build()]));
    let graph = DisplayGraph::build(Arc::clone(&topology));

    assert!(Arc::ptr_eq(graph.topology(), &topology));
}

#[test]
fn the_fingerprint_matches_the_topology_it_indexes() {
    let topology = Arc::new(Topology::new(vec![identified(0, "SN-A").build()]));
    let graph = DisplayGraph::build(Arc::clone(&topology));

    assert_eq!(graph.fingerprint(), &topology.fingerprint());
}
