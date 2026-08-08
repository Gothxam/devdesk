//! The Windows backend.
//!
//! Everything here is `#[cfg(windows)]` by virtue of the module being declared
//! under one, which is what DR-6 permits *only* in this crate.
//!
//! Two sources are consulted for every display, because neither is sufficient:
//!
//! - **GDI** (`EnumDisplayMonitors`, `GetMonitorInfoW`, `GetDpiForMonitor`) gives
//!   geometry, work area, primary flag, and effective DPI, but identifies a
//!   display only as `\\.\DISPLAY1` — a slot number that reorders on replug.
//! - **DisplayConfig** (`QueryDisplayConfig`) gives the port-stable device path,
//!   the EDID manufacturer and product code, the connector, and an exact
//!   rational refresh rate, but does not describe layout.
//!
//! They are correlated on the GDI device name, which both report. A display that
//! appears in GDI but not in DisplayConfig still enumerates — with fewer identity
//! signals, and the layer above will assign it a lower confidence rather than
//! inventing one.

mod edid;
mod monitors;
mod watcher;

use std::sync::Mutex;

use crate::backend::PlatformBackend;
use crate::display::{DisplayEventSink, RawMonitorInfo, SubscriptionId};
use crate::error::PlatformError;
use crate::feature::{PlatformFeature, Support};
use crate::platform::{Platform, PlatformId, WindowSystem};

use watcher::WatcherHandle;

/// The Win32 implementation of [`PlatformBackend`].
#[derive(Debug, Default)]
pub struct WindowsBackend {
    /// Live subscriptions, keyed by the id handed to the caller.
    ///
    /// A `Mutex` rather than a lock-free structure: subscribe and unsubscribe
    /// happen at startup and shutdown, so contention is not a consideration and
    /// the simpler primitive is the correct one.
    watchers: Mutex<Vec<(SubscriptionId, WatcherHandle)>>,
    next_id: Mutex<u64>,
}

impl WindowsBackend {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn platform_id() -> PlatformId {
        PlatformId::new(Platform::Windows, WindowSystem::Win32)
    }
}

impl PlatformBackend for WindowsBackend {
    fn id(&self) -> PlatformId {
        Self::platform_id()
    }

    fn supports(&self, feature: PlatformFeature) -> Support {
        match feature {
            PlatformFeature::MonitorEnumeration
            | PlatformFeature::PerMonitorDpi
            | PlatformFeature::DisplayChangeEvents
            | PlatformFeature::MonitorConnector
            | PlatformFeature::ExactRefreshRate => Support::Full,

            // Present for every display Windows can describe through
            // DisplayConfig, which excludes a display GDI sees but the
            // configuration database does not — some remote and mirrored
            // sessions. Partial rather than Full because a caller that assumed
            // it was always there would build identity on a signal that is
            // sometimes absent, and only on the configurations nobody tests.
            PlatformFeature::MonitorDevicePath => Support::Partial {
                note: "absent for displays Windows does not expose through DisplayConfig, \
                       such as some remote-session and mirrored displays",
            },

            // The serial lives in the EDID blob under the monitor's device
            // parameters. Virtual displays have no EDID at all, and some panels
            // ship one with the serial field zeroed.
            PlatformFeature::MonitorSerial => Support::Partial {
                note: "read from the EDID; absent for virtual displays and for panels \
                       that do not populate the serial field",
            },
        }
    }

    fn enumerate_monitors(&self) -> Result<Vec<RawMonitorInfo>, PlatformError> {
        monitors::enumerate()
    }

    fn subscribe_display_changes(
        &self,
        sink: DisplayEventSink,
    ) -> Result<SubscriptionId, PlatformError> {
        let handle = watcher::start(sink)?;

        let Ok(mut next) = self.next_id.lock() else {
            return Err(PlatformError::OsCall {
                call: "subscribe_display_changes",
                code: 0,
            });
        };
        *next += 1;
        let id = SubscriptionId(*next);
        drop(next);

        let Ok(mut watchers) = self.watchers.lock() else {
            return Err(PlatformError::OsCall {
                call: "subscribe_display_changes",
                code: 0,
            });
        };
        watchers.push((id, handle));

        Ok(id)
    }

    fn unsubscribe_display_changes(&self, id: SubscriptionId) -> Result<(), PlatformError> {
        let Ok(mut watchers) = self.watchers.lock() else {
            return Err(PlatformError::OsCall {
                call: "unsubscribe_display_changes",
                code: 0,
            });
        };

        if let Some(index) = watchers.iter().position(|(each, _)| *each == id) {
            let (_, handle) = watchers.remove(index);
            drop(watchers);
            handle.stop();
        }

        // An unknown id is not an error — see the trait documentation.
        Ok(())
    }
}
