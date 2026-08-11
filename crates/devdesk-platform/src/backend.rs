//! The seam every operating-system difference crosses.
//!
//! XP-1: all OS-specific behaviour is expressed through this trait, and
//! `#[cfg(target_os)]` outside this crate is prohibited (DR-6). The rule is
//! enforced by `scripts/lint-cfg-usage.mjs`, not by review.
//!
//! The trait is display-only today. That is deliberate: a method is added on the
//! day a caller needs it, because a stub returning `Unsupported` on every
//! platform is indistinguishable from a capability nobody implemented, and the
//! parity test in `tests` would certify it as correct.

use crate::display::{DisplayEventSink, RawMonitorInfo, RawRect, SubscriptionId};
use crate::error::PlatformError;
use crate::feature::{PlatformFeature, Support};
use crate::platform::PlatformId;
use crate::window::{Hotkey, HotkeySink, ShellEventSink, StyleChange, SurfaceLayer, WindowHandle};

/// The operating-system capabilities DevDesk depends on.
pub trait PlatformBackend: Send + Sync + 'static {
    /// Which platform and window system this backend is driving.
    fn id(&self) -> PlatformId;

    /// Whether a feature is available here, and with what caveat.
    ///
    /// XP-2: callers consult this before offering an action in the UI. Offering
    /// something that cannot succeed on the running platform is a defect, not a
    /// gracefully-handled edge case.
    fn supports(&self, feature: PlatformFeature) -> Support;

    /// Lists the attached displays.
    ///
    /// Returns raw records: what the system said, with the parts it did not say
    /// left absent rather than defaulted. A defaulted identity field is worse
    /// than a missing one, because the layer above cannot tell them apart and
    /// will assign a confidence the evidence does not support.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where enumeration is unavailable, and
    /// [`PlatformError::OsCall`] when the system refuses a call this backend
    /// expected to succeed.
    fn enumerate_monitors(&self) -> Result<Vec<RawMonitorInfo>, PlatformError>;

    /// Asks to be told when the display arrangement may have changed.
    ///
    /// WD-6: what arrives is a hint. The subscriber re-queries via
    /// [`PlatformBackend::enumerate_monitors`] for authoritative topology.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where the platform has no change
    /// notification, and [`PlatformError::OsCall`] when the subscription
    /// machinery cannot be established.
    fn subscribe_display_changes(
        &self,
        sink: DisplayEventSink,
    ) -> Result<SubscriptionId, PlatformError>;

    /// Ends a subscription.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where subscriptions do not exist. An
    /// unknown or already-ended id is **not** an error: teardown ordering is not
    /// something a caller should have to reason about during shutdown.
    fn unsubscribe_display_changes(&self, id: SubscriptionId) -> Result<(), PlatformError>;

    // ------------------------------------------------------------ windows --

    /// Attaches a DevDesk-created window to a z-order band.
    ///
    /// `ADR-0005` `DH-2`: the window **must** be one DevDesk created. Passing a
    /// window belonging to another process is prohibited, and the handle type
    /// makes it awkward rather than impossible — the obligation is the caller's.
    ///
    /// Every [`SurfaceLayer`] is accepted on every platform (`DH-22`). A caller
    /// asking whether this machine can do wallpaper needs an answer, not a
    /// compile error, so the ones a platform cannot do fail at runtime with a
    /// reason.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where the band has no attachment path, and
    /// on any failure in the attachment sequence (`DH-6`). Never a silent no-op
    /// (`XP-3`, `AP-15`), and never a partial attach (`DH-4`).
    fn attach_to_layer(
        &self,
        window: WindowHandle,
        layer: SurfaceLayer,
    ) -> Result<(), PlatformError>;

    /// Returns a window to ordinary top-level behaviour.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where attachment is unsupported. A window
    /// that was never attached is **not** an error, for the same reason an
    /// already-ended subscription is not: teardown ordering is not the caller's
    /// problem.
    fn detach_from_layer(&self, window: WindowHandle) -> Result<(), PlatformError>;

    /// Makes a whole window transparent to input, or takes it back.
    ///
    /// Independent of attachment (`DH-19`): meaningful for any window on any
    /// platform that has one.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where input transparency does not exist.
    fn set_click_through(
        &self,
        window: WindowHandle,
        enabled: bool,
    ) -> Result<StyleChange, PlatformError>;

    /// Gives a window keyboard focus.
    ///
    /// A window that has just become interactive needs it: a webview with no
    /// focus receives no `keydown`, so the key that leaves the interactive state
    /// would never arrive.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where the platform has no notion of
    /// foreground, and an OS error where it refuses — Windows grants foreground
    /// activation only to a process already entitled to it, and that refusal is
    /// reported rather than worked around.
    fn focus_window(&self, window: WindowHandle) -> Result<(), PlatformError>;

    /// Which window would receive a click at this screen point.
    ///
    /// The honest test for "is this window reachable", because it asks what the
    /// mouse asks. A caller that passes a point over its own surface and gets a
    /// different handle back knows the window is unreachable, whatever its
    /// styles say — which is exactly the failure styles alone cannot fix.
    ///
    /// Returns `None` where the platform cannot answer. `0` is not a sentinel:
    /// it is a valid answer meaning "no window there".
    fn window_at(&self, x: i32, y: i32) -> Option<u64>;

    /// Admits input only inside these rectangles.
    ///
    /// `DH-17`: the union of the surfaces the compositor reports as
    /// interactive, so a click that lands on the desktop between two widgets
    /// reaches the desktop. An **empty** slice admits no input at all, which is
    /// different from never calling this — the latter admits everything.
    ///
    /// Rectangles are in the window's own client coordinates.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where input regions do not exist.
    fn set_input_region(
        &self,
        window: WindowHandle,
        regions: &[RawRect],
    ) -> Result<(), PlatformError>;

    /// Excludes a window from screen capture, or stops excluding it.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where capture exclusion does not exist.
    fn exclude_from_capture(
        &self,
        window: WindowHandle,
        excluded: bool,
    ) -> Result<(), PlatformError>;

    /// Subscribes to shell restarts.
    ///
    /// `DH-10`: the event is a **hint**. The handler re-runs attachment from the
    /// beginning rather than trusting anything the event carries, for the same
    /// reason `WD-6` re-queries on a display change.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where the shell publishes no such signal.
    fn subscribe_shell_restart(
        &self,
        sink: ShellEventSink,
    ) -> Result<SubscriptionId, PlatformError>;

    /// Registers a key combination delivered regardless of what has focus.
    ///
    /// The only input path into a window that is click-through and behind the
    /// shell, which is every host window at rest. Without it, entering the
    /// interactive state would require input the window cannot receive — the
    /// deadlock this method exists to break.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where the platform has no such facility,
    /// and an OS error when the combination is already held by another process.
    /// Never silently swapped for a different combination: a hotkey the user was
    /// not told about is worse than no hotkey (`XP-3`).
    fn register_hotkey(
        &self,
        hotkey: Hotkey,
        sink: HotkeySink,
    ) -> Result<SubscriptionId, PlatformError>;

    /// Releases a hotkey registration.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where registration is unsupported. An
    /// unknown id is not an error.
    fn unregister_hotkey(&self, id: SubscriptionId) -> Result<(), PlatformError>;

    /// Ends a shell-restart subscription.
    ///
    /// # Errors
    ///
    /// [`PlatformError::Unsupported`] where subscriptions do not exist. An
    /// unknown id is not an error.
    fn unsubscribe_shell_restart(&self, id: SubscriptionId) -> Result<(), PlatformError>;
}
