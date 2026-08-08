//! What the operating system reports about attached displays, un-interpreted.
//!
//! These are **raw records**, not domain types. Every field is exactly what the
//! platform said, including the parts it declined to say — hence the `Option`s.
//! Identity resolution, coordinate-space tagging, scale validation, and topology
//! identity all belong to `devdesk-display`, which sits above this crate.
//!
//! The direction matters. `ADR-0003` §4.1 makes `devdesk-display` depend on
//! `devdesk-platform`; returning a `MonitorDescriptor` from here would invert
//! that and put display policy inside the OS shim. So this crate answers *what
//! the system said*, and the layer above decides *what it means*.

use core::fmt;
use std::sync::Arc;

/// A rectangle in device pixels, as the platform reported it.
///
/// Untagged on purpose: the coordinate-space newtypes (WD-1) are
/// `devdesk-display`'s, and a raw record has no business asserting a space it
/// did not verify.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The physical connector a display is attached through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ConnectorKind {
    DisplayPort,
    Hdmi,
    Dvi,
    Vga,
    /// Built into the machine — a laptop panel.
    Embedded,
    /// A virtual display: remote desktop, capture card, or a driver-created panel.
    Virtual,
    /// The platform named a connector this backend does not model.
    Other,
}

impl fmt::Display for ConnectorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::DisplayPort => "dp",
            Self::Hdmi => "hdmi",
            Self::Dvi => "dvi",
            Self::Vga => "vga",
            Self::Embedded => "embedded",
            Self::Virtual => "virtual",
            Self::Other => "other",
        };
        f.write_str(name)
    }
}

/// Which connector, and which instance of it.
///
/// The instance matters: "HDMI" alone does not distinguish two identical panels
/// on HDMI 1 and HDMI 2, which is precisely the case identity has to survive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Connector {
    pub kind: ConnectorKind,
    pub instance: u32,
}

impl fmt::Display for Connector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.kind, self.instance)
    }
}

/// One display, as the operating system described it.
///
/// Every identity field is optional because every one of them is genuinely
/// absent on some real configuration: a virtual display has no EDID serial, a
/// remote session has no connector, and a headless adapter has neither. The
/// layer above resolves identity from whichever signals arrived, with a
/// confidence that reflects which ones did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawMonitorInfo {
    /// A device path that is stable for as long as the display stays on the
    /// same port — Windows `\\?\DISPLAY#...`, and the equivalent elsewhere.
    pub device_path: Option<String>,
    /// The display adapter and output this monitor hangs off.
    pub adapter: Option<String>,
    /// The manufacturer serial number, from EDID.
    ///
    /// The strongest signal available and the only one that survives being
    /// moved to a different port, which is why it is read even though it costs
    /// a registry lookup.
    pub serial: Option<String>,
    /// The physical connector.
    pub connector: Option<Connector>,
    /// The EDID manufacturer identifier, e.g. `DEL` or `GSM`.
    pub manufacturer: Option<String>,
    /// The EDID product code, distinguishing models from one manufacturer.
    pub product_code: Option<u16>,
    /// A name for a human to match against hardware (`AC-MON-8.3`).
    ///
    /// Never an identity signal: it is neither unique nor stable, and a user who
    /// renames a display must not lose the layout bound to it.
    pub friendly_name: Option<String>,
    /// The GDI-style device name, e.g. `\\.\DISPLAY1`. Correlation key only.
    pub os_device_name: Option<String>,
    /// Full bounds in device pixels, including any area under OS chrome.
    pub bounds: RawRect,
    /// The usable area, excluding taskbars and docks.
    pub work_area: RawRect,
    /// Effective dots per inch for this display. 96 is 100%.
    ///
    /// Reported as DPI rather than a ratio because that is what the platform
    /// returns; the layer above turns it into a validated scale factor.
    pub dpi: u32,
    /// Refresh rate in millihertz, or `None` when the platform did not report
    /// one. Millihertz because 59.94 Hz is real (`PB-R1`).
    pub refresh_millihertz: Option<u32>,
    /// Whether the OS considers this the primary display.
    pub is_primary: bool,
    /// Where this display appeared in the OS enumeration.
    ///
    /// **Not an identity signal** (WD-3). It is carried so that the fallback
    /// identity of a display reporting nothing else is at least deterministic
    /// within a single enumeration, and it is named `os_` to make any use of it
    /// for identity conspicuous in review.
    pub os_enumeration_index: u32,
}

/// A hint that the display arrangement may have changed.
///
/// WD-6: a *hint*, never a payload to trust. The handler re-queries the OS for
/// authoritative topology. Event payloads race the state they describe — the
/// event says a monitor was added, the OS has already had it removed again, and
/// a handler that trusted the payload now holds a topology that never existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayEvent {
    /// Monitors were attached, detached, or rearranged.
    TopologyChanged,
    /// A scale factor changed without the arrangement changing.
    ScaleChanged,
}

/// Where display hints are delivered.
///
/// Called from a platform thread, so the callback must be cheap and must not
/// block: on Windows it runs inside a window procedure, and a slow one stalls
/// the message loop that produced it.
#[derive(Clone)]
pub struct DisplayEventSink(Arc<dyn Fn(DisplayEvent) + Send + Sync>);

impl DisplayEventSink {
    /// Wraps a callback.
    #[must_use]
    pub fn new(sink: impl Fn(DisplayEvent) + Send + Sync + 'static) -> Self {
        Self(Arc::new(sink))
    }

    /// Delivers a hint.
    pub fn emit(&self, event: DisplayEvent) {
        (self.0)(event);
    }
}

impl fmt::Debug for DisplayEventSink {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DisplayEventSink(..)")
    }
}

/// Handle to an active display-change subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SubscriptionId(pub u64);
