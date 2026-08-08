//! What one operation on the window subsystem produced.
//!
//! Every mutating call returns both what happened and what the host must do
//! about it, in one value. The alternative — a queue the manager fills and the
//! caller drains — makes forgetting to drain a silent failure whose symptom is a
//! window that never appears, a long way from the call that should have created
//! it.

use super::event::{WindowCommand, WindowEvent};

/// The events and commands one operation produced.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WindowOutcome {
    events: Vec<WindowEvent>,
    commands: Vec<WindowCommand>,
}

impl WindowOutcome {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            events: Vec::new(),
            commands: Vec::new(),
        }
    }

    /// What happened.
    #[must_use]
    pub fn events(&self) -> &[WindowEvent] {
        &self.events
    }

    /// What the host must do, in the order it must do it.
    ///
    /// Order is part of the contract: a show for a window always follows the
    /// create that made it, and a host executing them out of order would be
    /// asking to show a window that does not exist yet.
    #[must_use]
    pub fn commands(&self) -> &[WindowCommand] {
        &self.commands
    }

    /// Whether anything happened at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty() && self.commands.is_empty()
    }

    /// Whether any command in this outcome puts something on screen.
    #[must_use]
    pub fn makes_anything_visible(&self) -> bool {
        self.commands.iter().any(WindowCommand::makes_visible)
    }

    pub(super) fn push_event(&mut self, event: WindowEvent) {
        self.events.push(event);
    }

    pub(super) fn push_command(&mut self, command: WindowCommand) {
        self.commands.push(command);
    }

    pub(super) fn extend_events(&mut self, events: impl IntoIterator<Item = WindowEvent>) {
        self.events.extend(events);
    }

    /// Appends another outcome, preserving command order.
    pub(super) fn absorb(&mut self, other: Self) {
        self.events.extend(other.events);
        self.commands.extend(other.commands);
    }
}
