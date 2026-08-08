//! Desktops to test against.
//!
//! Built through `MonitorDescriptor::from_raw`, the same path production takes,
//! so identity and scale are resolved by the crate under test rather than
//! asserted by the fixture.

use devdesk_display::{MonitorDescriptor, SharedTopology, Topology};
use devdesk_platform::{Connector, ConnectorKind, RawMonitorInfo, RawRect};

use crate::window::SurfaceId;

/// One display, fully identified.
pub fn monitor(index: u32, serial: &str, x: i32, width: u32, primary: bool) -> MonitorDescriptor {
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
            width,
            height: 1080,
        },
        work_area: RawRect {
            x,
            y: 0,
            width,
            height: 1040,
        },
        dpi: 96,
        refresh_millihertz: Some(59_940),
        is_primary: primary,
        os_enumeration_index: index,
    };

    MonitorDescriptor::from_raw(&raw).expect("the fixture must describe a usable display")
}

/// A laptop panel plus an external display, the laptop primary.
pub fn docked() -> Topology {
    Topology::new(vec![
        monitor(0, "SN-LAPTOP", 0, 1920, true),
        monitor(1, "SN-EXTERNAL", 1920, 2560, false),
    ])
}

/// The laptop panel alone.
pub fn undocked() -> Topology {
    Topology::new(vec![monitor(0, "SN-LAPTOP", 0, 1920, true)])
}

/// The external display alone, and primary — a closed-lid dock.
pub fn external_only() -> Topology {
    Topology::new(vec![monitor(1, "SN-EXTERNAL", 0, 2560, true)])
}

/// No display attached. A real state: the lid is closed and nothing is plugged in.
pub fn dark() -> Topology {
    Topology::new(Vec::new())
}

/// A publisher primed with one arrangement.
pub fn published(initial: Topology) -> SharedTopology {
    let shared = SharedTopology::new();
    shared.publish(initial);
    shared
}

pub fn surface(name: &str) -> SurfaceId {
    SurfaceId::new(name).expect("a fixture surface id must be valid")
}
