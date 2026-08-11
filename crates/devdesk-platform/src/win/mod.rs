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
mod input;
mod layer;
mod monitors;
mod shell;
mod watcher;

use std::sync::Mutex;

use crate::backend::PlatformBackend;
use crate::display::{DisplayEventSink, RawMonitorInfo, RawRect, SubscriptionId};
use crate::error::PlatformError;
use crate::feature::{PlatformFeature, Support};
use crate::platform::{Platform, PlatformId, WindowSystem};
use crate::window::{ShellEventSink, SurfaceLayer, WindowHandle};

use shell::ShellWatcherHandle;
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

    /// Live shell-restart subscriptions. Separate from `watchers` because the
    /// two carry different handles and are torn down independently; sharing one
    /// list would mean a sum type whose only purpose is to be matched on again.
    shell_watchers: Mutex<Vec<(SubscriptionId, ShellWatcherHandle)>>,
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

    /// The next subscription id.
    ///
    /// Shared by both subscription kinds so an id is unique across the backend
    /// rather than only within its own list — passing a display id to
    /// `unsubscribe_shell_restart` then finds nothing instead of finding the
    /// wrong watcher.
    fn allocate_id(&self, call: &'static str) -> Result<SubscriptionId, PlatformError> {
        let Ok(mut next) = self.next_id.lock() else {
            return Err(PlatformError::OsCall { call, code: 0 });
        };

        *next += 1;
        Ok(SubscriptionId(*next))
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

            PlatformFeature::ClickThrough
            | PlatformFeature::InputRegion
            | PlatformFeature::CaptureExclusion
            | PlatformFeature::ShellRestartEvents => Support::Full,

            // DH-5: answered before anything is attached, so the UI never offers
            // desktop mode on a machine where it cannot work (XP-2). A session
            // with no Explorer desktop — Server Core, some kiosk and remote
            // configurations, a shell replacement — has no Progman to host it.
            PlatformFeature::WallpaperLayer => {
                if layer::is_supported() {
                    Support::Full
                } else {
                    Support::Unsupported {
                        reason: "this session has no Explorer desktop to attach to",
                    }
                }
            }
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

    fn attach_to_layer(
        &self,
        window: WindowHandle,
        layer: SurfaceLayer,
    ) -> Result<(), PlatformError> {
        layer::attach(window, layer)
    }

    fn detach_from_layer(&self, window: WindowHandle) -> Result<(), PlatformError> {
        layer::detach(window)
    }

    fn set_click_through(&self, window: WindowHandle, enabled: bool) -> Result<(), PlatformError> {
        input::set_click_through(window, enabled)
    }

    fn set_input_region(
        &self,
        window: WindowHandle,
        regions: &[RawRect],
    ) -> Result<(), PlatformError> {
        input::set_input_region(window, regions)
    }

    fn exclude_from_capture(
        &self,
        window: WindowHandle,
        excluded: bool,
    ) -> Result<(), PlatformError> {
        input::exclude_from_capture(window, excluded)
    }

    fn subscribe_shell_restart(
        &self,
        sink: ShellEventSink,
    ) -> Result<SubscriptionId, PlatformError> {
        let handle = shell::start(sink)?;
        let id = self.allocate_id("subscribe_shell_restart")?;

        let Ok(mut watchers) = self.shell_watchers.lock() else {
            // The registry is unusable, so this subscription can never be torn
            // down through it. Stopping it here is the only way to avoid leaking
            // a thread that would outlive every handle to it.
            handle.stop();

            return Err(PlatformError::OsCall {
                call: "subscribe_shell_restart",
                code: 0,
            });
        };
        watchers.push((id, handle));

        Ok(id)
    }

    fn unsubscribe_shell_restart(&self, id: SubscriptionId) -> Result<(), PlatformError> {
        let Ok(mut watchers) = self.shell_watchers.lock() else {
            return Err(PlatformError::OsCall {
                call: "unsubscribe_shell_restart",
                code: 0,
            });
        };

        if let Some(index) = watchers.iter().position(|(each, _)| *each == id) {
            let (_, handle) = watchers.remove(index);

            // Dropped before stopping: `stop` joins the watcher thread, and
            // holding the registry lock across a join is how a shutdown deadlocks
            // against a callback that is trying to subscribe.
            drop(watchers);
            handle.stop();
        }

        // An unknown id is not an error — see the trait documentation.
        Ok(())
    }
}

/// A NUL-terminated UTF-16 string for a Win32 `W` call.
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// This thread's last system error.
fn last_error() -> u32 {
    // SAFETY: reads a thread-local value; no pointers involved.
    unsafe { windows::Win32::Foundation::GetLastError() }.0
}

/// Clears this thread's last system error.
///
/// Needed before any call whose failure is indistinguishable from success by
/// return value alone — `SetWindowLongPtrW` returns `0` both for "the previous
/// value was 0" and for failure, and a stale error from an unrelated call would
/// otherwise be reported as this one's.
fn clear_last_error() {
    // SAFETY: writes a thread-local value; no pointers involved.
    unsafe { windows::Win32::Foundation::SetLastError(windows::Win32::Foundation::WIN32_ERROR(0)) };
}

/// Turns a `windows` error into a [`PlatformError::OsCall`].
///
/// The crate reports failures as an `HRESULT`, and for these APIs it is a
/// wrapped Win32 code. The low sixteen bits are that code; the rest is the
/// facility, which says only "this came from Win32" and is not worth carrying
/// into a message a user may read.
fn os_call(call: &'static str, error: &windows::core::Error) -> PlatformError {
    let hresult = error.code().0;

    PlatformError::OsCall {
        call,
        #[allow(clippy::cast_sign_loss)]
        code: (hresult as u32) & 0xFFFF,
    }
}
