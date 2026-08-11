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
use crate::window::{ShellEvent, ShellEventSink, SurfaceLayer, WindowHandle};

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

// -------------------------------------------------------------- ADR-0005 --

/// A handle that names no window.
///
/// Every assertion below is about the answer the backend gives *before* it
/// touches the window, so the handle never has to be real. A test that created
/// a genuine window would be testing Win32, not this contract.
fn nowhere() -> WindowHandle {
    WindowHandle::from_owned_window(0)
}

#[test]
fn the_normal_band_needs_no_attachment_anywhere() {
    // DH-22: the enum is not narrowed per platform. `Normal` is where an
    // ordinary window already is, so asking for it succeeds even on a backend
    // that can attach to nothing — the caller asked for the state it is in.
    assert!(!SurfaceLayer::Normal.needs_attachment());

    for layer in [
        SurfaceLayer::Wallpaper,
        SurfaceLayer::Desktop,
        SurfaceLayer::Overlay,
        SurfaceLayer::System,
    ] {
        assert!(layer.needs_attachment(), "{layer} must need attachment");
    }

    assert!(unsupported_backend()
        .attach_to_layer(nowhere(), SurfaceLayer::Normal)
        .is_ok());
}

#[test]
fn an_unimplemented_platform_refuses_the_wallpaper_band_with_a_reason() {
    // DH-6: never a silent no-op. The reason is what turns "my widgets are not
    // on the desktop" into something a user can act on.
    let backend = unsupported_backend();

    match backend.attach_to_layer(nowhere(), SurfaceLayer::Wallpaper) {
        Err(PlatformError::Unsupported {
            feature, reason, ..
        }) => {
            assert_eq!(feature, PlatformFeature::WallpaperLayer);
            assert!(!reason.trim().is_empty());
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }
}

#[test]
fn every_window_capability_names_the_feature_it_is_missing() {
    // A caller deciding whether to offer desktop mode needs to know *which*
    // capability is absent, not merely that something is. Reporting the wrong
    // feature would send it down the wrong degradation path (XP-2).
    let backend = unsupported_backend();

    let attempts: [(Result<(), PlatformError>, PlatformFeature); 3] = [
        (
            // Discarding the style report: this asserts the *refusal*, and a
            // backend that supports nothing has no style to report.
            backend.set_click_through(nowhere(), true).map(|_| ()),
            PlatformFeature::ClickThrough,
        ),
        (
            backend.set_input_region(nowhere(), &[]),
            PlatformFeature::InputRegion,
        ),
        (
            backend.exclude_from_capture(nowhere(), true),
            PlatformFeature::CaptureExclusion,
        ),
    ];

    for (result, expected) in attempts {
        match result {
            Err(PlatformError::Unsupported {
                feature, reason, ..
            }) => {
                assert_eq!(feature, expected);
                assert!(!reason.trim().is_empty(), "{expected} gave no reason");
            }
            other => panic!("expected Unsupported for {expected}, got {other:?}"),
        }
    }

    match backend.subscribe_shell_restart(ShellEventSink::new(|_| {})) {
        Err(PlatformError::Unsupported { feature, .. }) => {
            assert_eq!(feature, PlatformFeature::ShellRestartEvents);
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }
}

#[test]
fn teardown_of_something_that_never_started_succeeds() {
    // Same reason as display subscriptions: shutdown ordering is not the
    // caller's problem, and a detach of a window that was never attached is a
    // no-op rather than a failure.
    let backend = unsupported_backend();

    assert!(backend.detach_from_layer(nowhere()).is_ok());
    assert!(backend
        .unsubscribe_shell_restart(crate::display::SubscriptionId(9_999))
        .is_ok());
}

/// The shell watcher must establish and tear down without leaking its thread.
///
/// The same production-only failure as the display watcher: a loop that never
/// stops keeps running past shutdown, and the process looks exited while a
/// thread is still pumping.
#[test]
fn a_shell_subscription_can_be_established_and_torn_down() {
    let backend = crate::current_backend();

    if !backend
        .supports(PlatformFeature::ShellRestartEvents)
        .is_available()
    {
        return;
    }

    let sink = ShellEventSink::new(|_event| {});
    let id = backend
        .subscribe_shell_restart(sink)
        .expect("subscription must succeed where the feature is available");

    backend
        .unsubscribe_shell_restart(id)
        .expect("teardown must succeed");
}

#[test]
fn subscription_ids_are_unique_across_both_kinds() {
    // A shared counter rather than one per list: handing the same number to two
    // kinds of subscription would make `unsubscribe` on the wrong one silently
    // stop the wrong watcher.
    let backend = crate::current_backend();

    if !backend
        .supports(PlatformFeature::DisplayChangeEvents)
        .is_available()
        || !backend
            .supports(PlatformFeature::ShellRestartEvents)
            .is_available()
    {
        return;
    }

    let display = backend
        .subscribe_display_changes(DisplayEventSink::new(|_| {}))
        .expect("display subscription");
    let shell = backend
        .subscribe_shell_restart(ShellEventSink::new(|_| {}))
        .expect("shell subscription");

    assert_ne!(display, shell, "ids must not collide across kinds");

    backend.unsubscribe_display_changes(display).unwrap();
    backend.unsubscribe_shell_restart(shell).unwrap();
}

#[test]
fn a_shell_sink_delivers_what_it_is_given() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let count = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&count);

    let sink = ShellEventSink::new(move |_event| {
        observed.fetch_add(1, Ordering::SeqCst);
    });

    sink.emit(ShellEvent::Restarted);

    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[test]
fn a_platform_that_cannot_hit_test_says_so_rather_than_answering_zero() {
    // `0` is a valid answer meaning "no window there". A backend that cannot
    // answer must not borrow it, or a caller checking whether its own window is
    // reachable reads "cannot tell" as "nothing is there" (`AP-15`).
    assert_eq!(unsupported_backend().window_at(10, 10), None);
}

#[test]
fn an_unimplemented_platform_refuses_focus_and_hotkeys_with_a_reason() {
    let backend = unsupported_backend();

    match backend.focus_window(nowhere()) {
        Err(PlatformError::Unsupported { reason, .. }) => assert!(!reason.trim().is_empty()),
        other => panic!("expected Unsupported, got {other:?}"),
    }

    match backend.register_hotkey(
        crate::window::Hotkey::ctrl_shift(b'D'.into()),
        crate::window::HotkeySink::new(|| {}),
    ) {
        Err(PlatformError::Unsupported { feature, .. }) => {
            assert_eq!(feature, PlatformFeature::GlobalHotkey);
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }

    // Releasing something that was never registered succeeds, like every other
    // teardown here.
    assert!(backend
        .unregister_hotkey(crate::display::SubscriptionId(9_999))
        .is_ok());
}

/// A hotkey must be registrable and releasable without leaking its thread.
///
/// The production-only failure again: a registration that is never released
/// holds a system-wide combination for the rest of the session, and every other
/// application silently loses that key.
#[test]
fn a_hotkey_can_be_registered_and_released() {
    let backend = crate::current_backend();

    if !backend
        .supports(PlatformFeature::GlobalHotkey)
        .is_available()
    {
        return;
    }

    // F24 rather than anything a person uses: this runs in CI beside whatever
    // else is on the machine, and claiming a real combination even briefly would
    // take it away from them.
    let hotkey = crate::window::Hotkey::ctrl_shift(0x87);
    let sink = crate::window::HotkeySink::new(|| {});

    let Ok(id) = backend.register_hotkey(hotkey, sink) else {
        // Another process holds it. A refusal is the documented outcome and not
        // a test failure — see `Support::Partial` for this feature.
        return;
    };

    backend
        .unregister_hotkey(id)
        .expect("release must succeed once registration did");
}

#[test]
fn a_hotkey_prints_as_something_a_user_could_be_told_to_press() {
    use crate::window::Hotkey;

    // The string reaches a log line the user reads to find out which key opens
    // edit mode, so a debug-shaped rendering would be a dead end for them.
    assert_eq!(Hotkey::ctrl_shift(b'D'.into()).to_string(), "Ctrl+Shift+D");
    assert!(Hotkey::ctrl_shift(0x87)
        .to_string()
        .starts_with("Ctrl+Shift+"));
}

#[test]
fn a_style_change_shows_both_sides() {
    use crate::window::StyleChange;

    // Both numbers travel together because the interesting case is them being
    // equal after a change was asked for — invisible if only one is reported.
    let unchanged = StyleChange {
        before: 0x0004_0130,
        after: 0x0004_0130,
    };

    assert_eq!(unchanged.to_string(), "0x00040130 -> 0x00040130");
    assert_eq!(unchanged.before, unchanged.after);
}
