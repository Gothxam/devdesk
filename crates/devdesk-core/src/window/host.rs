//! The seam between the window subsystem and whatever actually owns windows.
//!
//! `WindowManager` decides; a [`WindowCommandSink`] does. The sink is
//! implemented in `apps/desktop` against Tauri, and this crate never learns what
//! a webview is — which is what lets the whole subsystem be tested without a
//! display server.
//!
//! [`SurfaceHost`] is the only thing that holds both. It takes the lock, calls
//! the manager, and dispatches the resulting commands **in order**, so a caller
//! cannot advance the state without the host acting on it. That coupling is the
//! point: a surface that reached `Revealed` in the manager but was never shown
//! is exactly as broken as one shown too early, and it is harder to notice.
//!
//! ## Failure
//!
//! A command that fails does not roll the state back. If `Show` fails, the
//! manager still believes the surface is revealed, and that is deliberate: the
//! alternative is a manager that reverts to `FirstFrameReady`, is asked to
//! reveal again by the next frame signal, and retries forever against a window
//! that cannot be shown. The error is returned so the caller can decide, and the
//! surface is left in a state that does not loop.

use std::sync::{Mutex, MutexGuard};

use devdesk_display::{MonitorId, TopologyTransaction};

use super::event::WindowCommand;
use super::id::SurfaceId;
use super::manager::{ObserveError, WindowError, WindowManager};
use super::outcome::WindowOutcome;

/// Executes window commands against the real windowing system.
///
/// Implementations live outside this crate. `Send + Sync` because the host is
/// shared: display change hints arrive on a platform thread while IPC commands
/// arrive on Tauri's.
pub trait WindowCommandSink: Send + Sync + 'static {
    /// Performs one command.
    ///
    /// # Errors
    ///
    /// Whatever the windowing system reported, as a string. The core has no
    /// vocabulary for a webview failing to create, and inventing one here would
    /// be a taxonomy of a subsystem this crate deliberately knows nothing about.
    fn execute(&self, command: &WindowCommand) -> Result<(), String>;
}

/// A sink that does nothing, for tests and for headless runs.
///
/// Recording what it was asked to do is left to the test that needs it; this one
/// exists so a `SurfaceHost` can be constructed where there is no windowing
/// system at all.
#[derive(Debug, Clone, Copy, Default)]
pub struct NullSink;

impl WindowCommandSink for NullSink {
    fn execute(&self, _command: &WindowCommand) -> Result<(), String> {
        Ok(())
    }
}

/// Why a host operation failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    /// The manager refused.
    #[error(transparent)]
    Window(#[from] WindowError),

    /// The manager refused a topology transaction.
    #[error(transparent)]
    Observe(#[from] ObserveError),

    /// The windowing system refused a command.
    ///
    /// Carries which command failed, because "creating a window failed" and
    /// "showing an existing window failed" have different causes and different
    /// remedies.
    #[error("the windowing system refused {command:?}: {detail}")]
    Sink {
        command: Box<WindowCommand>,
        detail: String,
    },
}

/// The window subsystem, wired to a real windowing system.
pub struct SurfaceHost {
    manager: Mutex<WindowManager>,
    sink: Box<dyn WindowCommandSink>,
}

impl core::fmt::Debug for SurfaceHost {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("SurfaceHost").finish_non_exhaustive()
    }
}

impl SurfaceHost {
    /// Wires a manager to a sink.
    #[must_use]
    pub fn new(sink: impl WindowCommandSink) -> Self {
        Self {
            manager: Mutex::new(WindowManager::new()),
            sink: Box::new(sink),
        }
    }

    /// Adopts a topology transaction and performs whatever it implies.
    ///
    /// # Errors
    ///
    /// [`HostError::Observe`] if the transaction is stale, and [`HostError::Sink`]
    /// if a command failed.
    pub fn observe(&self, transaction: &TopologyTransaction) -> Result<WindowOutcome, HostError> {
        let outcome = self.manager().observe(transaction)?;
        self.dispatch(&outcome)?;
        Ok(outcome)
    }

    /// Registers a surface, creating its window hidden.
    ///
    /// # Errors
    ///
    /// [`HostError::Window`] if the identity is taken, and [`HostError::Sink`] if
    /// the window could not be created.
    pub fn register(&self, surface: SurfaceId) -> Result<WindowOutcome, HostError> {
        let outcome = self.manager().register_surface(surface)?;
        self.dispatch(&outcome)?;
        Ok(outcome)
    }

    /// Assigns a surface to a display, recording that it belongs there.
    ///
    /// How a restored arrangement is applied. Produces no commands — which
    /// display a surface belongs to is association, and moving its window is
    /// placement.
    ///
    /// # Errors
    ///
    /// [`HostError::Window`] if the surface is unknown or the display is not
    /// attached.
    pub fn assign(
        &self,
        surface: &SurfaceId,
        monitor: &MonitorId,
    ) -> Result<WindowOutcome, HostError> {
        let outcome = self.manager().assign(surface, monitor)?;
        self.dispatch(&outcome)?;
        Ok(outcome)
    }

    /// Reports that a surface's window now exists.
    ///
    /// # Errors
    ///
    /// [`HostError::Window`] if the surface is unknown.
    pub fn report_window_created(&self, surface: &SurfaceId) -> Result<WindowOutcome, HostError> {
        let outcome = self.manager().note_window_created(surface)?;
        self.dispatch(&outcome)?;
        Ok(outcome)
    }

    /// Reports that a surface has painted, revealing it.
    ///
    /// This is the whole of the no-flash path from the outside: nothing else
    /// makes a surface visible.
    ///
    /// # Errors
    ///
    /// [`HostError::Window`] if the surface is unknown or has no window yet, and
    /// [`HostError::Sink`] if the show failed.
    pub fn report_first_frame(&self, surface: &SurfaceId) -> Result<WindowOutcome, HostError> {
        let outcome = self.manager().note_first_frame(surface)?;
        self.dispatch(&outcome)?;
        Ok(outcome)
    }

    /// Removes a surface and destroys its window.
    ///
    /// # Errors
    ///
    /// [`HostError::Window`] if the surface is unknown, and [`HostError::Sink`]
    /// if the window could not be destroyed.
    pub fn remove(&self, surface: &SurfaceId) -> Result<WindowOutcome, HostError> {
        let outcome = self.manager().remove_surface(surface)?;
        self.dispatch(&outcome)?;
        Ok(outcome)
    }

    /// Runs a read-only query against the manager.
    ///
    /// Takes a closure rather than returning a guard so the lock cannot be held
    /// across a caller's arbitrary work.
    pub fn with_manager<T>(&self, read: impl FnOnce(&WindowManager) -> T) -> T {
        read(&self.manager())
    }

    /// Performs an outcome's commands, in order.
    fn dispatch(&self, outcome: &WindowOutcome) -> Result<(), HostError> {
        for command in outcome.commands() {
            self.sink
                .execute(command)
                .map_err(|detail| HostError::Sink {
                    command: Box::new(command.clone()),
                    detail,
                })?;
        }
        Ok(())
    }

    /// Reads through a poisoned lock rather than propagating the panic.
    ///
    /// EM-1 forbids `unwrap`. Refusing to manage windows for the rest of the
    /// session because something unrelated panicked would take the desktop down
    /// with it; the manager's own invariants are upheld by its methods, not by
    /// the lock.
    fn manager(&self) -> MutexGuard<'_, WindowManager> {
        self.manager
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
