//! The reveal sequence, and the invariant it exists to hold.

use crate::window::{
    RevealError, RevealState, RevealStateMachine, RevealStep, WindowCommand, WindowError,
    WindowEvent, WindowManager,
};

use super::fixtures::{dark, docked, published, surface};

fn machine() -> RevealStateMachine {
    RevealStateMachine::new()
}

#[test]
fn a_new_surface_is_created_and_invisible() {
    let machine = machine();
    assert_eq!(machine.state(), RevealState::Created);
    assert!(!machine.is_visible());
    assert!(!machine.can_reveal());
}

#[test]
fn the_sequence_runs_created_attached_ready_revealed() {
    let mut machine = machine();

    assert_eq!(
        machine.attach().expect("attach").advanced(),
        Some((RevealState::Created, RevealState::Attached))
    );
    assert!(!machine.is_visible());

    assert_eq!(
        machine.first_frame().expect("first frame").advanced(),
        Some((RevealState::Attached, RevealState::FirstFrameReady))
    );
    assert!(!machine.is_visible(), "painting is not showing");
    assert!(machine.can_reveal());

    let revealed = machine.reveal().expect("reveal");
    assert_eq!(
        revealed.advanced(),
        Some((RevealState::FirstFrameReady, RevealState::Revealed))
    );
    assert!(revealed.revealed_now());
    assert!(machine.is_visible());
}

#[test]
fn revealing_before_a_frame_is_refused_from_every_earlier_state() {
    // The invariant. A window shown before its content has painted is a white
    // rectangle on the user's desktop for one to several frames — worst on
    // exactly the machines that are already slowest.
    let mut created = machine();
    assert!(matches!(
        created.reveal(),
        Err(RevealError::NotReady {
            state: RevealState::Created
        })
    ));
    assert!(!created.is_visible());

    let mut attached = machine();
    attached.attach().expect("attach");
    assert!(matches!(
        attached.reveal(),
        Err(RevealError::NotReady {
            state: RevealState::Attached
        })
    ));
    assert!(!attached.is_visible());
}

#[test]
fn a_frame_cannot_be_ready_for_a_window_nobody_created() {
    // Accepting the claim would let a surface reach FirstFrameReady, and then
    // visibility, without a window to be visible in.
    let mut machine = machine();

    assert!(matches!(
        machine.first_frame(),
        Err(RevealError::OutOfOrder {
            state: RevealState::Created,
            attempted: RevealStep::FirstFrame,
        })
    ));
    assert_eq!(machine.state(), RevealState::Created);
}

#[test]
fn repeating_a_step_that_has_already_happened_is_not_a_fault() {
    // A webview that reloads signals its first frame again. Treating that as an
    // error — or worse, as a reason to hide and re-show — would produce the
    // flash on every reload.
    let mut machine = machine();
    machine.attach().expect("attach");
    machine.first_frame().expect("first frame");
    machine.reveal().expect("reveal");

    assert!(machine.attach().expect("attach again").advanced().is_none());
    assert!(machine
        .first_frame()
        .expect("reload signals again")
        .advanced()
        .is_none());
    assert!(machine.reveal().expect("reveal again").advanced().is_none());

    assert_eq!(machine.state(), RevealState::Revealed);
    assert!(machine.is_visible(), "and it stayed on screen throughout");
}

#[test]
fn the_sequence_never_runs_backwards() {
    // Forward only. Hiding a revealed surface would be visual behaviour, and
    // what happens to one whose display left is a layout decision this crate
    // does not make.
    let mut machine = machine();
    machine.attach().expect("attach");
    machine.first_frame().expect("first frame");
    machine.reveal().expect("reveal");

    for _ in 0..5 {
        machine.attach().expect("no-op");
        machine.first_frame().expect("no-op");
        assert_eq!(machine.state(), RevealState::Revealed);
    }
}

/// Every ordering of the three steps, to a depth of five.
///
/// The invariant is a property over sequences, not over one path, so it is
/// asserted over all of them rather than over the one a correct caller takes.
/// `3^5` orderings, each checked after every step: visibility implies a frame
/// was accepted first.
#[test]
fn no_ordering_of_steps_can_reveal_a_surface_that_has_not_painted() {
    const STEPS: [RevealStep; 3] = [
        RevealStep::Attach,
        RevealStep::FirstFrame,
        RevealStep::Reveal,
    ];

    fn walk(machine: RevealStateMachine, painted: bool, depth: usize) {
        assert!(
            !machine.is_visible() || painted,
            "reached {:?} without a frame",
            machine.state()
        );

        if depth == 0 {
            return;
        }

        for step in STEPS {
            let mut next = machine;
            let accepted = match step {
                RevealStep::Attach => next.attach().is_ok(),
                RevealStep::FirstFrame => next.first_frame().is_ok(),
                RevealStep::Reveal => next.reveal().is_ok(),
            };

            let painted_now = painted
                || (step == RevealStep::FirstFrame && accepted && next.state().has_painted());

            walk(next, painted_now, depth - 1);
        }
    }

    walk(RevealStateMachine::new(), false, 5);
}

// The manager side: reveal steps drive the same machine, and only a real
// transition produces an event.

fn manager_with_surface() -> WindowManager {
    let shared = published(dark());
    let transaction = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");
    manager
}

#[test]
fn a_registered_surface_starts_invisible() {
    let manager = manager_with_surface();
    let record = manager
        .surfaces()
        .get(&surface("devdesk.clock"))
        .expect("registered");

    assert_eq!(record.reveal_state(), RevealState::Created);
    assert!(!record.is_visible());
    assert!(manager.surfaces().visible().is_empty());
}

#[test]
fn the_manager_reveals_on_the_first_frame_and_not_before() {
    let mut manager = manager_with_surface();
    let id = surface("devdesk.clock");

    let attached = manager.note_window_created(&id).expect("window exists");
    let attached = attached.events();
    assert_eq!(attached.len(), 1);
    assert!(!manager
        .surfaces()
        .get(&id)
        .expect("registered")
        .is_visible());

    let revealed = manager.note_first_frame(&id).expect("painted");
    let revealed = revealed.events();

    // Two transitions, in order: the frame, then the reveal.
    assert_eq!(revealed.len(), 2);
    assert!(matches!(
        revealed[0],
        WindowEvent::SurfaceRevealAdvanced {
            from: RevealState::Attached,
            to: RevealState::FirstFrameReady,
            ..
        }
    ));
    assert!(matches!(
        revealed[1],
        WindowEvent::SurfaceRevealAdvanced {
            from: RevealState::FirstFrameReady,
            to: RevealState::Revealed,
            ..
        }
    ));
    assert!(manager
        .surfaces()
        .get(&id)
        .expect("registered")
        .is_visible());
    assert_eq!(manager.surfaces().visible().len(), 1);
}

#[test]
fn the_manager_refuses_a_frame_for_a_window_that_was_never_created() {
    let mut manager = manager_with_surface();

    assert!(matches!(
        manager.note_first_frame(&surface("devdesk.clock")),
        Err(WindowError::Reveal(RevealError::OutOfOrder { .. }))
    ));
}

#[test]
fn a_reload_after_reveal_emits_nothing() {
    // "The surface reached Revealed" must stay distinguishable from "something
    // asked again about a surface that already had".
    let mut manager = manager_with_surface();
    let id = surface("devdesk.clock");

    manager.note_window_created(&id).expect("window exists");
    manager.note_first_frame(&id).expect("painted");

    let again = manager.note_first_frame(&id).expect("a reload");
    let again = again.events();
    assert!(again.is_empty());
    assert!(manager
        .surfaces()
        .get(&id)
        .expect("registered")
        .is_visible());
}

#[test]
fn a_show_command_is_produced_only_by_the_reveal_transition() {
    // The no-flash property, stated over the command list: nothing that makes a
    // window visible is emitted until the frame arrives, and the create that
    // precedes it is hidden.
    let shared = published(dark());
    let transaction = shared.publish(docked()).expect("a change");
    let mut manager = WindowManager::new();
    manager.observe(&transaction).expect("adopted");

    let id = surface("devdesk.clock");
    let registered = manager.register_surface(id.clone()).expect("registered");
    assert!(!registered.makes_anything_visible());
    assert!(matches!(
        registered.commands()[0],
        WindowCommand::CreateHidden { .. }
    ));

    let attached = manager.note_window_created(&id).expect("window exists");
    assert!(
        attached.commands().is_empty(),
        "a window existing is not a window being shown"
    );

    let revealed = manager.note_first_frame(&id).expect("painted");
    assert_eq!(revealed.commands().len(), 1);
    assert!(revealed.commands()[0].makes_visible());
    assert_eq!(
        revealed.commands()[0].window(),
        registered.commands()[0].window(),
        "the same window that was created hidden"
    );

    // And a reload asks for nothing.
    let again = manager.note_first_frame(&id).expect("a reload");
    assert!(again.commands().is_empty());
}

#[test]
fn a_topology_change_never_shows_anything() {
    // A hidden surface stays hidden through a docking event. Revealing on a
    // display change would put an unpainted window on screen at the worst
    // possible moment.
    let shared = published(dark());
    let first = shared.publish(docked()).expect("a change");
    let mut manager = WindowManager::new();
    manager.observe(&first).expect("adopted");
    manager
        .register_surface(surface("devdesk.clock"))
        .expect("registered");

    for topology in [dark(), docked(), dark()] {
        if let Some(transaction) = shared.publish(topology) {
            let outcome = manager.observe(&transaction).expect("adopted");
            assert!(
                outcome.commands().is_empty(),
                "a display change asked the host to do something: {:?}",
                outcome.commands()
            );
        }
    }
}

#[test]
fn removing_a_surface_asks_for_its_window_to_be_destroyed() {
    let mut manager = manager_with_surface();
    let id = surface("devdesk.clock");
    let window = manager.surfaces().get(&id).expect("registered").window();

    let removed = manager.remove_surface(&id).expect("removed");

    assert_eq!(removed.commands().len(), 1);
    assert!(matches!(
        removed.commands()[0],
        WindowCommand::Destroy { .. }
    ));
    assert_eq!(removed.commands()[0].window(), window);
}

#[test]
fn reveal_steps_for_an_unknown_surface_are_errors() {
    let mut manager = manager_with_surface();

    assert!(manager.note_window_created(&surface("nothing")).is_err());
    assert!(manager.note_first_frame(&surface("nothing")).is_err());
}

#[test]
fn a_topology_change_does_not_disturb_reveal_state() {
    // Detaching a surface changes where it is, not how far along it is. A
    // revealed surface stays revealed; deciding otherwise is layout's call.
    let shared = published(dark());
    let first = shared.publish(docked()).expect("a change");

    let mut manager = WindowManager::new();
    manager.observe(&first).expect("adopted");
    let id = surface("devdesk.clock");
    manager.register_surface(id.clone()).expect("registered");
    manager.note_window_created(&id).expect("window exists");
    manager.note_first_frame(&id).expect("painted");

    let blackout = shared.publish(dark()).expect("everything unplugged");
    let outcome = manager.observe(&blackout).expect("adopted");
    let events = outcome.events();

    let record = manager.surfaces().get(&id).expect("still here");
    assert!(record.monitor().is_none(), "it has no display");
    assert!(record.is_visible(), "and its reveal state did not move");

    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WindowEvent::SurfaceRevealAdvanced { .. })),
        "a topology change is not a reveal step"
    );
}
