//! Platform contract tests.
//!
//! XP-5: every backend is asserted to have identical *semantics*, including that
//! an unsupported path returns `Unsupported` with a reason rather than erroring
//! differently per operating system. These run against whichever backend the
//! host provides, so the same assertions execute on every CI runner and each one
//! covers the backend it can actually reach.
//!
//! EM-1 prohibits unwrap/expect in non-test code; asserting a precondition in a
//! test is the intended use.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use crate::backend::PlatformBackend;
use crate::display::{DisplayEvent, DisplayEventSink};
use crate::error::PlatformError;
use crate::feature::{PlatformFeature, Support};
use crate::platform::{Platform, PlatformId, WindowSystem};
use crate::unsupported::UnsupportedBackend;

fn unsupported_backend() -> UnsupportedBackend {
    UnsupportedBackend::new(
        PlatformId::new(Platform::Linux, WindowSystem::Wayland),
        "test backend",
    )
}

#[test]
fn every_feature_has_an_explicit_support_answer() {
    // The mechanism only works if no feature can be reached without one. A
    // backend that added a method and forgot the arm would fail here rather
    // than at a user's desk (AP-15).
    let backend = crate::current_backend();

    for feature in PlatformFeature::ALL {
        let support = backend.supports(*feature);
        assert!(
            support.note().is_some() || support == Support::Full,
            "{feature} returned a caveat-free non-Full answer"
        );
    }
}

#[test]
fn an_unsupported_feature_always_carries_a_reason() {
    // XP-3: a silent no-op is prohibited. An empty reason is the same defect
    // with a different shape — the user still gets "nothing happens".
    let backend = crate::current_backend();

    for feature in PlatformFeature::ALL {
        if let Support::Unsupported { reason } = backend.supports(*feature) {
            assert!(!reason.trim().is_empty(), "{feature} gave an empty reason");
        }
        if let Support::Partial { note } = backend.supports(*feature) {
            assert!(!note.trim().is_empty(), "{feature} gave an empty caveat");
        }
    }
}

#[test]
fn an_unimplemented_platform_refuses_enumeration_rather_than_reporting_none() {
    // An empty list means a machine with no displays attached, which a caller
    // may legitimately handle. This machine has displays that cannot be seen.
    // Collapsing the two is exactly AP-15.
    let backend = unsupported_backend();

    match backend.enumerate_monitors() {
        Err(PlatformError::Unsupported {
            feature, reason, ..
        }) => {
            assert_eq!(feature, PlatformFeature::MonitorEnumeration);
            assert!(!reason.is_empty());
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }
}

#[test]
fn unsubscribing_something_that_never_started_succeeds() {
    // Shutdown ordering is not something a caller should have to reason about.
    let backend = unsupported_backend();
    assert!(backend
        .unsubscribe_display_changes(crate::display::SubscriptionId(9_999))
        .is_ok());
}

#[test]
fn a_sink_delivers_what_it_is_given() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let count = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&count);

    let sink = DisplayEventSink::new(move |_event| {
        observed.fetch_add(1, Ordering::SeqCst);
    });

    sink.emit(DisplayEvent::TopologyChanged);
    sink.emit(DisplayEvent::ScaleChanged);

    assert_eq!(count.load(Ordering::SeqCst), 2);
}

#[test]
fn the_current_backend_names_a_window_system_not_just_an_os() {
    // XP-6: "Linux" is not one platform for window and display purposes, and a
    // backend that reported only the OS family would let a caller offer layering
    // that silently fails on half of it.
    let id = crate::current_backend().id();

    match id.platform {
        Platform::Windows => assert_eq!(id.window_system, WindowSystem::Win32),
        Platform::MacOs => assert_eq!(id.window_system, WindowSystem::Quartz),
        Platform::Linux => assert!(matches!(
            id.window_system,
            WindowSystem::X11 | WindowSystem::Wayland | WindowSystem::Unknown
        )),
    }
}

/// Enumeration against the real machine this test is running on.
///
/// Skipped where the backend has no implementation, because there is nothing to
/// assert about a platform that correctly reports it cannot answer.
#[test]
fn enumeration_describes_a_usable_desktop() {
    let backend = crate::current_backend();

    if !backend
        .supports(PlatformFeature::MonitorEnumeration)
        .is_available()
    {
        return;
    }

    let monitors = backend
        .enumerate_monitors()
        .expect("enumeration must succeed");
    assert!(
        !monitors.is_empty(),
        "a machine running this test has at least one display"
    );

    for monitor in &monitors {
        assert!(monitor.bounds.width > 0 && monitor.bounds.height > 0);
        assert!(monitor.work_area.width > 0 && monitor.work_area.height > 0);
        // Zero DPI would make every downstream conversion divide by zero, and
        // the failure would surface far from here.
        assert!(monitor.dpi > 0, "a display must report a usable dpi");
        assert!(monitor.work_area.width <= monitor.bounds.width);
        assert!(monitor.work_area.height <= monitor.bounds.height);
    }

    assert!(
        monitors.iter().filter(|m| m.is_primary).count() <= 1,
        "at most one display is primary"
    );
}

/// Subscribing and unsubscribing must not leak a thread or hang.
///
/// The teardown path is the one that only fails in production: a watcher that
/// never stops keeps a message loop alive past shutdown, and the process appears
/// to exit while a thread is still running.
#[test]
fn a_display_subscription_can_be_established_and_torn_down() {
    let backend = crate::current_backend();

    if !backend
        .supports(PlatformFeature::DisplayChangeEvents)
        .is_available()
    {
        return;
    }

    let sink = DisplayEventSink::new(|_event| {});
    let id = backend
        .subscribe_display_changes(sink)
        .expect("subscription must succeed where the feature is available");

    backend
        .unsubscribe_display_changes(id)
        .expect("teardown must succeed");
}
