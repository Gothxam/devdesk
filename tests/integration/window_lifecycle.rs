//! The window subsystem end to end, from a platform record to a show command.
//!
//! The unit tests in `devdesk-core` check each piece against its own contract.
//! This checks the pieces against each other — a topology published by
//! `devdesk-display`, adopted by a `WindowManager`, driving a `SurfaceHost`
//! whose sink records what a real windowing system would have been asked to do.
//!
//! Everything here asserts over the **recorded command log**, because that is
//! what a user actually experiences. A surface is on screen exactly when a show
//! command has been executed for it, and `AC-FRE-1.1` is the claim that no such
//! command is ever executed for a window whose content has not painted.
//!
//! EM-1 prohibits unwrap/expect in *non-test* code; a test asserting a
//! precondition is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use devdesk_core::window::{
    HostError, RevealState, SurfaceHost, SurfaceId, WindowCommand, WindowCommandSink, WindowId,
};
use devdesk_display::{MonitorDescriptor, SharedTopology, Topology};
use devdesk_platform::{Connector, ConnectorKind, RawMonitorInfo, RawRect};

// ---------------------------------------------------------------- fixtures --

fn monitor(index: u32, serial: &str, x: i32, primary: bool) -> MonitorDescriptor {
    let raw = RawMonitorInfo {
        device_path: Some(format!(r"\\?\DISPLAY#ACM1234#5&port{index}&0&UID{index}")),
        adapter: Some(format!("00000000dead:{index}")),
        serial: Some(serial.to_owned()),
        connector: Some(Connector {
            kind: ConnectorKind::DisplayPort,
            instance: index,
        }),
        manufacturer: Some("ACM".to_owned()),
        product_code: Some(0x1234),
        friendly_name: Some(format!("ACME {serial}")),
        os_device_name: Some(format!(r"\\.\DISPLAY{}", index + 1)),
        bounds: RawRect {
            x,
            y: 0,
            width: 1920,
            height: 1080,
        },
        work_area: RawRect {
            x,
            y: 0,
            width: 1920,
            height: 1040,
        },
        dpi: if index == 0 { 96 } else { 144 },
        refresh_millihertz: Some(59_940),
        is_primary: primary,
        os_enumeration_index: index,
    };

    MonitorDescriptor::from_raw(&raw).expect("the fixture must describe a usable display")
}

/// Laptop panel at 100% plus an external display at 150% — mixed DPI, which
/// `PS-4` makes the assumed case.
fn docked() -> Topology {
    Topology::new(vec![
        monitor(0, "SN-LAPTOP", 0, true),
        monitor(1, "SN-EXTERNAL", 1920, false),
    ])
}

fn undocked() -> Topology {
    Topology::new(vec![monitor(0, "SN-LAPTOP", 0, true)])
}

fn dark() -> Topology {
    Topology::new(Vec::new())
}

fn surface(name: &str) -> SurfaceId {
    SurfaceId::new(name).expect("a fixture surface id must be valid")
}

// -------------------------------------------------------------------- sink --

/// A sink that records what it was asked to do, and can be told to fail.
#[derive(Debug, Default)]
struct RecordingSink {
    log: Mutex<Vec<WindowCommand>>,
    fail_show: Mutex<bool>,
}

impl RecordingSink {
    fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn log(&self) -> Vec<WindowCommand> {
        self.log
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn set_fail_show(&self, fail: bool) {
        *self
            .fail_show
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = fail;
    }

    /// Whether a window was ever shown before it was created.
    ///
    /// The property `AC-FRE-1.1` reduces to at this layer.
    fn shown_before_created(&self) -> bool {
        let mut created: Vec<WindowId> = Vec::new();
        for command in self.log() {
            match command {
                WindowCommand::CreateHidden { window, .. } => created.push(window),
                WindowCommand::Show { window, .. } if !created.contains(&window) => return true,
                _ => {}
            }
        }
        false
    }

    fn count(&self, matching: impl Fn(&WindowCommand) -> bool) -> usize {
        self.log().iter().filter(|c| matching(c)).count()
    }
}

/// The sink handed to the host, sharing one log with the test.
///
/// A newtype because the orphan rule forbids implementing a foreign trait for
/// `Arc<RecordingSink>` directly.
struct SinkHandle(Arc<RecordingSink>);

impl WindowCommandSink for SinkHandle {
    fn execute(&self, command: &WindowCommand) -> Result<(), String> {
        if command.makes_visible()
            && *self
                .0
                .fail_show
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
        {
            return Err("the windowing system refused".to_owned());
        }

        self.0
            .log
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(command.clone());
        Ok(())
    }
}

fn host() -> (SurfaceHost, Arc<RecordingSink>) {
    let sink = RecordingSink::shared();
    (SurfaceHost::new(SinkHandle(Arc::clone(&sink))), sink)
}

// ------------------------------------------------------------------- tests --

#[test]
fn a_surface_reaches_the_screen_only_through_the_full_sequence() {
    let (host, sink) = host();
    let displays = SharedTopology::new();

    let first = displays.publish(docked()).expect("a first observation");
    host.observe(&first).expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");

    // Created, and hidden. Nothing is on screen.
    assert_eq!(
        sink.count(|c| matches!(c, WindowCommand::CreateHidden { .. })),
        1
    );
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("registered");
        assert_eq!(record.reveal_state(), RevealState::Created);
        assert!(record.monitor().is_some(), "and it has a display");
    });

    // The window exists. Still nothing on screen.
    host.report_window_created(&clock).expect("window exists");
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);

    // It painted. Now, and only now.
    host.report_first_frame(&clock).expect("painted");
    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
    assert!(!sink.shown_before_created());

    host.with_manager(|manager| {
        assert!(manager
            .surfaces()
            .get(&clock)
            .expect("registered")
            .is_visible());
    });
}

#[test]
fn a_frame_reported_before_a_window_exists_shows_nothing() {
    // The state machine refuses, the host propagates, and no command reaches
    // the windowing system.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");

    let refused = host.report_first_frame(&clock);
    assert!(matches!(refused, Err(HostError::Window(_))));
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
}

#[test]
fn a_full_docking_cycle_asks_the_windowing_system_for_nothing() {
    // Three arrangements, a surface that has never painted, and not one command
    // beyond its creation. A hidden surface stays hidden through a dock, an
    // undock, and a blackout.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    host.register(surface("devdesk.clock")).expect("registered");
    let after_creation = sink.log().len();

    for arrangement in [undocked(), dark(), docked()] {
        if let Some(transaction) = displays.publish(arrangement) {
            host.observe(&transaction).expect("adopted");
        }
    }

    assert_eq!(sink.log().len(), after_creation, "{:?}", sink.log());
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
}

#[test]
fn a_revealed_surface_survives_a_docking_cycle_and_goes_home() {
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");
    host.report_first_frame(&clock).expect("painted");

    // Put it on the external display deliberately — this is what applying a
    // restored arrangement looks like.
    let external = host.with_manager(|manager| {
        manager
            .graph()
            .monitors()
            .iter()
            .find(|m| m.identity.serial() == Some("SN-EXTERNAL"))
            .map(|m| m.id().clone())
            .expect("attached")
    });
    host.assign(&clock, &external).expect("assigned");

    let commands_before_the_cycle = sink.log().len();

    host.observe(&displays.publish(undocked()).expect("undocked"))
        .expect("adopted");
    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("still here");
        assert_ne!(record.monitor(), Some(&external), "its display left");
        assert!(record.is_displaced(), "but it still belongs there");
        assert!(record.is_visible(), "and it did not blink out");
    });

    host.observe(&displays.publish(docked()).expect("redocked"))
        .expect("adopted");
    host.with_manager(|manager| {
        let record = manager.surfaces().get(&clock).expect("still here");
        assert_eq!(record.monitor(), Some(&external), "it went home");
        assert!(!record.is_displaced());
    });

    // The whole cycle asked the windowing system for nothing: association is
    // not placement, and a visible surface does not re-reveal.
    assert_eq!(sink.log().len(), commands_before_the_cycle);
    assert_eq!(sink.count(WindowCommand::makes_visible), 1);
}

#[test]
fn a_show_that_fails_does_not_retry_forever() {
    // Rolling the state back would have the next frame signal ask to reveal
    // again, against a window that cannot be shown.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    host.register(clock.clone()).expect("registered");
    host.report_window_created(&clock).expect("window exists");

    sink.set_fail_show(true);
    let failed = host.report_first_frame(&clock);
    assert!(matches!(failed, Err(HostError::Sink { .. })));

    // The manager still believes it is revealed, so a second frame signal is a
    // no-op rather than another attempt.
    sink.set_fail_show(false);
    let again = host.report_first_frame(&clock).expect("a reload");
    assert!(
        again.commands().is_empty(),
        "a failed show must not become a retry loop"
    );
    assert_eq!(sink.count(WindowCommand::makes_visible), 0);
}

#[test]
fn removing_a_surface_destroys_exactly_its_own_window() {
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let clock = surface("devdesk.clock");
    let monitorette = surface("devdesk.system-monitor");
    host.register(clock.clone()).expect("registered");
    host.register(monitorette.clone()).expect("registered");

    let clock_window =
        host.with_manager(|manager| manager.surfaces().get(&clock).expect("registered").window());

    host.remove(&clock).expect("removed");

    let destroyed: Vec<WindowId> = sink
        .log()
        .into_iter()
        .filter_map(|command| match command {
            WindowCommand::Destroy { window, .. } => Some(window),
            _ => None,
        })
        .collect();

    assert_eq!(destroyed, vec![clock_window]);
    host.with_manager(|manager| {
        assert!(!manager.surfaces().contains(&clock));
        assert!(manager.surfaces().contains(&monitorette));
    });
}

#[test]
fn concurrent_surfaces_each_get_one_window_and_one_reveal() {
    // The host is shared across threads by design: display hints arrive on a
    // platform thread while frame reports arrive on the IPC thread. Every
    // surface must end up created once and shown once, whatever the interleaving.
    let (host, sink) = host();
    let displays = SharedTopology::new();
    host.observe(&displays.publish(docked()).expect("observed"))
        .expect("adopted");

    let host = Arc::new(host);
    let names: Vec<String> = (0..16).map(|index| format!("surface-{index}")).collect();

    let mut threads = Vec::new();
    for name in names.clone() {
        let host = Arc::clone(&host);
        threads.push(std::thread::spawn(move || {
            let id = surface(&name);
            host.register(id.clone()).expect("registered");
            host.report_window_created(&id).expect("window exists");
            host.report_first_frame(&id).expect("painted");
        }));
    }

    for thread in threads {
        thread.join().expect("no thread may fail");
    }

    assert_eq!(
        sink.count(|c| matches!(c, WindowCommand::CreateHidden { .. })),
        names.len()
    );
    assert_eq!(sink.count(WindowCommand::makes_visible), names.len());
    assert!(!sink.shown_before_created());

    host.with_manager(|manager| {
        assert_eq!(manager.surfaces().len(), names.len());
        assert_eq!(manager.surfaces().visible().len(), names.len());
    });
}

#[test]
fn window_identities_stay_distinct_under_concurrent_registration() {
    // A reused identity would let a command queued for one surface reach
    // another's window.
    let (host, _sink) = host();
    let host = Arc::new(host);

    let mut threads = Vec::new();
    for index in 0..32 {
        let host = Arc::clone(&host);
        threads.push(std::thread::spawn(move || {
            host.register(surface(&format!("surface-{index}")))
                .expect("registered");
        }));
    }
    for thread in threads {
        thread.join().expect("no thread may fail");
    }

    host.with_manager(|manager| {
        let mut windows: Vec<WindowId> = manager
            .surfaces()
            .iter()
            .map(devdesk_core::window::SurfaceRecord::window)
            .collect();
        let total = windows.len();
        windows.sort_unstable();
        windows.dedup();

        assert_eq!(windows.len(), total, "every window identity is distinct");
        assert_eq!(total, 32);
    });
}
