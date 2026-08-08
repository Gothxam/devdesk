//! The two identities.

use crate::window::{SurfaceId, WindowId, WindowIdAllocator};

#[test]
fn a_surface_identity_cannot_be_empty() {
    // An empty identity would be stored, looked up, and matched against another
    // empty one — every unnamed surface sharing one arrangement, which is the
    // same defect as two displays agreeing on an absent serial.
    assert!(SurfaceId::new("clock").is_some());
    assert!(SurfaceId::new("").is_none());
    assert!(SurfaceId::new("   ").is_none());
    assert!(SurfaceId::new("\t\n").is_none());
}

#[test]
fn a_surface_identity_keeps_what_it_was_given() {
    let id = SurfaceId::new("devdesk.clock#2").expect("valid");
    assert_eq!(id.as_str(), "devdesk.clock#2");
    assert_eq!(id.to_string(), "devdesk.clock#2");
}

#[test]
fn window_identities_are_monotonic_and_never_reused() {
    // Reusing a retired id would let a command queued for a destroyed window
    // arrive at its replacement — a surface flickering on an unrelated display.
    let mut allocator = WindowIdAllocator::new();

    let first = allocator.allocate();
    let second = allocator.allocate();
    let third = allocator.allocate();

    assert!(first < second && second < third);
    assert_eq!(allocator.issued(), 3);
}

#[test]
fn the_absent_window_identity_is_never_allocated() {
    let mut allocator = WindowIdAllocator::new();

    assert!(WindowId::NONE.is_none());
    assert!(!allocator.allocate().is_none());
    assert_ne!(allocator.allocate(), WindowId::NONE);
}

#[test]
fn a_surface_identity_is_storable_and_a_window_identity_is_not() {
    // The doctrine in one assertion: what survives a restart derives serde, and
    // what does not, does not. `WindowId` deriving Serialize would compile and
    // would be wrong — window 3 from a previous run compares equal to window 3
    // from this one.
    let id = SurfaceId::new("devdesk.clock").expect("valid");
    let stored = serde_json::to_string(&id).expect("a surface id is storable");
    let restored: SurfaceId = serde_json::from_str(&stored).expect("and readable back");

    assert_eq!(id, restored);
}
