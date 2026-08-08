//! Shared fixtures and a recording sink for the window integration suites.
//!
//! Displays are built through `MonitorDescriptor::from_raw`, the same path
//! production takes, so identity and scale are resolved by the code under test
//! rather than asserted by the fixture.
//!
//! The sink is where the invariants are actually checked. What a user
//! experiences is the sequence of commands the windowing system received, so the
//! properties are phrased over that log rather than over internal state:
//! nothing shown before it was created, nothing created or shown twice, nothing
//! shown that had not painted.
#![allow(dead_code)]

use std::sync::{Arc, Mutex, PoisonError};

use devdesk_core::window::{
    SurfaceHost, SurfaceId, WindowCommand, WindowCommandSink, WindowId, WindowManager,
};
use devdesk_display::{MonitorDescriptor, MonitorId, Topology};
use devdesk_platform::{Connector, ConnectorKind, RawMonitorInfo, RawRect};

// ---------------------------------------------------------------- displays --

/// One display, fully identified. `index` also selects the scale factor, so a
/// two-display fixture is mixed-DPI — `PS-4`'s assumed case.
pub fn monitor(index: u32, serial: &str, x: i32, primary: bool) -> MonitorDescriptor {
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
        dpi: if index.is_multiple_of(2) { 96 } else { 144 },
        refresh_millihertz: Some(59_940),
        is_primary: primary,
        os_enumeration_index: index,
    };

    MonitorDescriptor::from_raw(&raw).expect("the fixture must describe a usable display")
}

/// Laptop panel at 100%, primary, plus an external display at 150%.
pub fn docked() -> Topology {
    Topology::new(vec![
        monitor(0, "SN-LAPTOP", 0, true),
        monitor(1, "SN-EXTERNAL", 1920, false),
    ])
}

/// The laptop panel alone.
pub fn undocked() -> Topology {
    Topology::new(vec![monitor(0, "SN-LAPTOP", 0, true)])
}

/// The external display alone, and primary — a closed-lid dock.
pub fn external_only() -> Topology {
    Topology::new(vec![monitor(1, "SN-EXTERNAL", 0, true)])
}

/// Neither original display, and one that was never seen before.
///
/// A *replacement* rather than a move: nothing here shares an identity with
/// anything in [`docked`], so every surface has to be re-associated.
pub fn replaced() -> Topology {
    Topology::new(vec![monitor(2, "SN-REPLACEMENT", 0, true)])
}

/// No display attached. A real state: the lid is closed and nothing is plugged in.
pub fn dark() -> Topology {
    Topology::new(Vec::new())
}

pub fn surface(name: &str) -> SurfaceId {
    SurfaceId::new(name).expect("a fixture surface id must be valid")
}

/// The identity of an attached display, by serial.
pub fn monitor_id(host: &SurfaceHost, serial: &str) -> MonitorId {
    host.with_manager(|manager| {
        manager
            .graph()
            .monitors()
            .iter()
            .find(|m| m.identity.serial() == Some(serial))
            .map(|m| m.id().clone())
            .expect("the fixture display must be attached")
    })
}

/// The identity of an attached display, from a manager reference.
pub fn monitor_id_in(manager: &WindowManager, serial: &str) -> Option<MonitorId> {
    manager
        .graph()
        .monitors()
        .iter()
        .find(|m| m.identity.serial() == Some(serial))
        .map(|m| m.id().clone())
}

// -------------------------------------------------------------------- sink --

/// A sink that records what it was asked to do, and can be told to refuse.
#[derive(Debug, Default)]
pub struct RecordingSink {
    log: Mutex<Vec<WindowCommand>>,
    fail_show: Mutex<bool>,
    fail_create: Mutex<bool>,
}

impl RecordingSink {
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn log(&self) -> Vec<WindowCommand> {
        self.log
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn set_fail_show(&self, fail: bool) {
        *self
            .fail_show
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = fail;
    }

    pub fn set_fail_create(&self, fail: bool) {
        *self
            .fail_create
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = fail;
    }

    pub fn count(&self, matching: impl Fn(&WindowCommand) -> bool) -> usize {
        self.log().iter().filter(|c| matching(c)).count()
    }

    /// Whether any window was shown before it was created.
    ///
    /// What `AC-FRE-1.1` reduces to at this layer: the flash is a show that
    /// arrives without, or before, the create that made the window hidden.
    pub fn shown_before_created(&self) -> bool {
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

    /// Whether any window was created twice or shown twice.
    ///
    /// A second create leaks a window; a second show is a visible flicker.
    pub fn has_duplicates(&self) -> bool {
        let mut created: Vec<WindowId> = Vec::new();
        let mut shown: Vec<WindowId> = Vec::new();

        for command in self.log() {
            match command {
                WindowCommand::CreateHidden { window, .. } => {
                    if created.contains(&window) {
                        return true;
                    }
                    created.push(window);
                }
                WindowCommand::Show { window, .. } => {
                    if shown.contains(&window) {
                        return true;
                    }
                    shown.push(window);
                }
                WindowCommand::Destroy { .. } => {}
            }
        }

        false
    }

    /// Every window that was destroyed, in order.
    pub fn destroyed(&self) -> Vec<WindowId> {
        self.log()
            .into_iter()
            .filter_map(|command| match command {
                WindowCommand::Destroy { window, .. } => Some(window),
                _ => None,
            })
            .collect()
    }
}

/// The sink handed to the host, sharing one log with the test.
///
/// A newtype because the orphan rule forbids implementing a foreign trait for
/// `Arc<RecordingSink>` directly.
pub struct SinkHandle(Arc<RecordingSink>);

impl WindowCommandSink for SinkHandle {
    fn execute(&self, command: &WindowCommand) -> Result<(), String> {
        let refuse = match command {
            WindowCommand::Show { .. } => *self
                .0
                .fail_show
                .lock()
                .unwrap_or_else(PoisonError::into_inner),
            WindowCommand::CreateHidden { .. } => *self
                .0
                .fail_create
                .lock()
                .unwrap_or_else(PoisonError::into_inner),
            WindowCommand::Destroy { .. } => false,
        };

        if refuse {
            return Err("the windowing system refused".to_owned());
        }

        self.0
            .log
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(command.clone());
        Ok(())
    }
}

/// A host wired to a recording sink, and the log to inspect it with.
pub fn host() -> (SurfaceHost, Arc<RecordingSink>) {
    let sink = RecordingSink::shared();
    (SurfaceHost::new(SinkHandle(Arc::clone(&sink))), sink)
}
