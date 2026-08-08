//! Building platform records to test against.
//!
//! Tests construct [`RawMonitorInfo`] and go through `MonitorDescriptor::from_raw`
//! rather than building descriptors directly. That keeps the identity resolution
//! under test on the path production uses: a fixture that hand-assembled an
//! identity would assert the test's model of identity, not the crate's.

use devdesk_platform::{Connector, ConnectorKind, RawMonitorInfo, RawRect};

use crate::geometry::{PhysicalPoint, PhysicalRect, PhysicalSize, ScaleFactor};
use crate::monitor::MonitorDescriptor;

/// A display record with everything absent except what a display must report.
///
/// The starting point is deliberately *impoverished*: a test that wants a
/// device path or a serial says so, which makes the identity signals each test
/// depends on visible in the test itself.
#[derive(Debug, Clone)]
pub struct Raw {
    inner: RawMonitorInfo,
}

impl Raw {
    pub fn new(index: u32) -> Self {
        Self {
            inner: RawMonitorInfo {
                device_path: None,
                adapter: None,
                serial: None,
                connector: None,
                manufacturer: None,
                product_code: None,
                friendly_name: None,
                os_device_name: Some(format!(r"\\.\DISPLAY{}", index + 1)),
                bounds: RawRect {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                },
                work_area: RawRect {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1040,
                },
                dpi: 96,
                refresh_millihertz: Some(59_940),
                is_primary: index == 0,
                os_enumeration_index: index,
            },
        }
    }

    pub fn device_path(mut self, path: &str) -> Self {
        self.inner.device_path = Some(path.to_owned());
        self
    }

    pub fn adapter(mut self, adapter: &str) -> Self {
        self.inner.adapter = Some(adapter.to_owned());
        self
    }

    pub fn serial(mut self, serial: &str) -> Self {
        self.inner.serial = Some(serial.to_owned());
        self
    }

    pub fn connector(mut self, kind: ConnectorKind, instance: u32) -> Self {
        self.inner.connector = Some(Connector { kind, instance });
        self
    }

    pub fn model(mut self, manufacturer: &str, product_code: u16) -> Self {
        self.inner.manufacturer = Some(manufacturer.to_owned());
        self.inner.product_code = Some(product_code);
        self
    }

    pub fn name(mut self, name: &str) -> Self {
        self.inner.friendly_name = Some(name.to_owned());
        self
    }

    pub fn bounds(mut self, x: i32, y: i32, width: u32, height: u32) -> Self {
        self.inner.bounds = RawRect {
            x,
            y,
            width,
            height,
        };
        self.inner.work_area = RawRect {
            x,
            y,
            width,
            height: height.saturating_sub(40),
        };
        self
    }

    pub fn dpi(mut self, dpi: u32) -> Self {
        self.inner.dpi = dpi;
        self
    }

    pub fn refresh_millihertz(mut self, refresh: Option<u32>) -> Self {
        self.inner.refresh_millihertz = refresh;
        self
    }

    pub fn primary(mut self, is_primary: bool) -> Self {
        self.inner.is_primary = is_primary;
        self
    }

    pub fn enumeration_index(mut self, index: u32) -> Self {
        self.inner.os_enumeration_index = index;
        self
    }

    pub fn raw(&self) -> &RawMonitorInfo {
        &self.inner
    }

    pub fn build(&self) -> MonitorDescriptor {
        MonitorDescriptor::from_raw(&self.inner).expect("fixture must describe a usable display")
    }
}

/// A fully-identified display: serial, model, device path, connector, adapter.
pub fn identified(index: u32, serial: &str) -> Raw {
    Raw::new(index)
        .device_path(&format!(r"\\?\DISPLAY#ACM1234#5&port{index}&0&UID{index}"))
        .adapter(&format!("00000000dead:{index}"))
        .serial(serial)
        .model("ACM", 0x1234)
        .connector(ConnectorKind::DisplayPort, index)
        .name(&format!("ACME {serial}"))
}

pub fn scale(value: f64) -> ScaleFactor {
    ScaleFactor::new(value).expect("test scale factor must be valid")
}

pub fn rect(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect {
    PhysicalRect {
        origin: PhysicalPoint { x, y },
        size: PhysicalSize { width, height },
    }
}
