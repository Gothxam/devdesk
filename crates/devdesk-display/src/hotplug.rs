//! Coalescing display-change hints.
//!
//! WD-6: hotplug events are debounced, default 250 ms, and treated as *hints* —
//! the handler re-queries the OS for authoritative topology rather than trusting
//! the event payload.
//!
//! Both halves matter. Undocking a laptop emits a burst of events over a few
//! hundred milliseconds as each output is torn down, and re-enumerating on each
//! one produces a sequence of arrangements that existed only momentarily and
//! that nobody asked to be laid out for. Debouncing collapses the burst into one
//! re-query of the state that settled.
//!
//! Time is passed in rather than read from the clock, so the burst behaviour is
//! tested by describing a burst rather than by sleeping through one. A test that
//! sleeps for a debounce window is slow on a good day and flaky on a busy CI
//! runner, and it verifies the machine's scheduler as much as this logic.

use std::time::{Duration, Instant};

/// The default debounce window (WD-6).
pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(250);

/// Collapses a burst of hints into one re-query.
#[derive(Debug, Clone)]
pub struct HotplugDebouncer {
    window: Duration,
    /// When the most recent hint arrived, if one is outstanding.
    latest_hint: Option<Instant>,
}

impl Default for HotplugDebouncer {
    fn default() -> Self {
        Self::new(DEFAULT_DEBOUNCE)
    }
}

impl HotplugDebouncer {
    #[must_use]
    pub const fn new(window: Duration) -> Self {
        Self {
            window,
            latest_hint: None,
        }
    }

    /// Records a hint from the platform.
    ///
    /// Each hint restarts the window rather than extending an existing deadline.
    /// A docking event whose outputs settle over 400 ms would otherwise fire a
    /// re-query in the middle of it, against an arrangement still changing.
    pub fn hint(&mut self, now: Instant) {
        self.latest_hint = Some(now);
    }

    /// Whether a re-query is outstanding.
    #[must_use]
    pub const fn is_pending(&self) -> bool {
        self.latest_hint.is_some()
    }

    /// How long until the current burst is considered settled.
    ///
    /// `None` when nothing is pending. A caller driving this from a timer uses
    /// it to sleep exactly as long as needed rather than polling.
    #[must_use]
    pub fn time_remaining(&self, now: Instant) -> Option<Duration> {
        let hint = self.latest_hint?;
        Some(
            self.window
                .saturating_sub(now.saturating_duration_since(hint)),
        )
    }

    /// Whether the burst has settled, consuming the pending hint if so.
    ///
    /// Returns `true` at most once per burst: the caller then re-queries the
    /// platform for authoritative topology. Consuming rather than merely
    /// reporting is what stops one burst from producing one re-query per poll.
    pub fn take_if_settled(&mut self, now: Instant) -> bool {
        let Some(hint) = self.latest_hint else {
            return false;
        };

        if now.saturating_duration_since(hint) < self.window {
            return false;
        }

        self.latest_hint = None;
        true
    }

    /// Abandons any pending hint.
    ///
    /// Used on shutdown, so a re-query cannot fire against a platform backend
    /// whose subscription has already been torn down.
    pub fn cancel(&mut self) {
        self.latest_hint = None;
    }
}
