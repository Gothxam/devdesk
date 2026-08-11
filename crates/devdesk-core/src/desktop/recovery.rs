//! Getting the desktop back after Explorer restarts.
//!
//! `ADR-0005` `DH-9`: an Explorer restart destroys `WorkerW` and orphans every
//! window parented to it. `DH-11`: recovery re-runs attachment **from the
//! beginning**, including re-enumerating displays, because a restart can coincide
//! with a resolution change and re-attaching against stale topology puts surfaces
//! off-screen. `DH-12`: debounced on the same `WD-6` 250 ms window as hotplug,
//! and a failure leaves DevDesk in window mode rather than retrying forever.
//!
//! Time arrives as a parameter (`TS-6`): every decision here is a function of the
//! instants it is given, so the tests assert the debounce without sleeping.

use std::time::Duration;

/// `WD-6`'s window, shared with display hotplug.
///
/// Explorer emits `TaskbarCreated` more than once during a restart on some
/// builds — the taskbar, then the desktop — and re-running attachment for each
/// would tear down and rebuild the desktop twice in a second.
pub const RECOVERY_DEBOUNCE: Duration = Duration::from_millis(250);

/// How many consecutive failures before giving up.
///
/// `DH-12` prohibits retrying indefinitely, and this is the bound. Six attempts
/// with the backoff below span about sixteen seconds, which is what an Explorer
/// restart actually costs: `TaskbarCreated` arrives when the *taskbar* is
/// created, and the desktop's `WorkerW` is rebuilt some seconds later. A budget
/// measured in hundreds of milliseconds gives up while the shell is still
/// starting and reports a machine that cannot attach when in fact nobody waited.
pub const MAX_ATTEMPTS: u32 = 6;

/// The longest gap between attempts.
///
/// Caps the doubling so a late attempt is still a wait rather than a hang, and
/// so the total is arithmetic anyone can check: 0.25 + 0.5 + 1 + 2 + 4 + 8.
pub const MAX_BACKOFF: Duration = Duration::from_secs(8);

/// How long to wait before attempt number `attempts`.
///
/// Doubling, because the two failure modes want different things. A restart
/// still in progress wants patience measured in seconds; a machine that can
/// never attach wants to reach the ceiling and stop. One retry every 250 ms
/// would serve the first badly and spend the idle budget (`B-4`) doing it.
#[must_use]
pub const fn backoff_for(attempts: u32) -> Duration {
    let millis = match RECOVERY_DEBOUNCE.as_millis().checked_shl(attempts) {
        Some(scaled) => scaled,
        // The shift overflowed, which means the attempt count is far past
        // `MAX_ATTEMPTS` and `poll` has already abandoned. The cap is the only
        // answer that cannot be wrong.
        None => MAX_BACKOFF.as_millis(),
    };

    if millis > MAX_BACKOFF.as_millis() {
        MAX_BACKOFF
    } else {
        Duration::from_millis(millis as u64)
    }
}

/// A monotonic clock reading, in milliseconds since an arbitrary origin.
///
/// Deliberately not a `SystemTime`: a wall clock that steps backwards over a
/// leap second or an NTP correction would make a debounce window either never
/// close or close instantly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct RecoveryClock(pub u64);

impl RecoveryClock {
    /// Milliseconds elapsed since `earlier`.
    ///
    /// Saturating: a reading that went backwards reports zero elapsed rather
    /// than an enormous one, so a clock anomaly holds the debounce open for one
    /// more tick instead of firing a re-attach storm.
    #[must_use]
    pub const fn since(self, earlier: Self) -> Duration {
        Duration::from_millis(self.0.saturating_sub(earlier.0))
    }
}

/// What the caller should do now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReattachTrigger {
    /// Nothing yet — the debounce window is still open.
    Wait,

    /// Re-enumerate displays and re-attach every host window (`DH-11`).
    Reattach,

    /// Give up and stay in window mode (`DH-7`, `DH-12`).
    ///
    /// Carries no reason: the reason is the last attachment failure, which the
    /// caller already has. Inventing a second one here would report the
    /// symptom in place of the cause.
    Abandon,
}

/// Tracks shell restarts and decides when to re-attach.
///
/// One instance for the whole desktop, not one per host window: Explorer
/// restarting is a single event that invalidates every attachment, and per-window
/// state would run the debounce as many times as there are monitors.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RecoveryState {
    /// When the most recent hint arrived. `None` when nothing is pending.
    pending_since: Option<RecoveryClock>,

    /// Consecutive failed attempts since the last success.
    attempts: u32,
}

impl RecoveryState {
    /// A desktop that is attached and has seen no restart.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            pending_since: None,
            attempts: 0,
        }
    }

    /// Records a shell-restart hint.
    ///
    /// A hint arriving while one is already pending **restarts** the window
    /// rather than extending or ignoring it, matching `WD-6`: the last event in
    /// a burst is the one whose state is real, and Explorer's own restart
    /// produces a burst.
    pub const fn hint(&mut self, at: RecoveryClock) {
        self.pending_since = Some(at);
    }

    /// What to do at this instant.
    ///
    /// Pure: asking twice at the same instant gives the same answer, and asking
    /// changes nothing. The caller commits by calling [`Self::attempted`].
    #[must_use]
    pub const fn poll(&self, now: RecoveryClock) -> ReattachTrigger {
        let Some(since) = self.pending_since else {
            return ReattachTrigger::Wait;
        };

        if self.attempts >= MAX_ATTEMPTS {
            return ReattachTrigger::Abandon;
        }

        if now.since(since).as_millis() < backoff_for(self.attempts).as_millis() {
            return ReattachTrigger::Wait;
        }

        ReattachTrigger::Reattach
    }

    /// Records the outcome of an attempt the caller made.
    ///
    /// On success the state returns to rest. On failure the pending window
    /// **reopens from `at`**, so the next attempt is a debounce away rather than
    /// immediate — a failure loop with no delay is the busy-wait `DH-12` is
    /// about, and it would spend the idle budget (`B-4`) on a machine that is
    /// already not working.
    pub const fn attempted(&mut self, at: RecoveryClock, succeeded: bool) {
        if succeeded {
            self.pending_since = None;
            self.attempts = 0;
        } else {
            self.pending_since = Some(at);
            self.attempts = self.attempts.saturating_add(1);
        }
    }

    /// Whether a restart is waiting to be handled.
    #[must_use]
    pub const fn is_pending(&self) -> bool {
        self.pending_since.is_some()
    }

    /// Consecutive failures since the last success.
    #[must_use]
    pub const fn attempts(&self) -> u32 {
        self.attempts
    }
}
