//! When a surface is allowed to become visible.
//!
//! ## The invariant
//!
//! > **A surface MUST NOT become visible before `FirstFrameReady`.**
//!
//! `AC-FRE-1.1`. A window shown before its content has painted is a white or
//! transparent rectangle on the user's desktop for one to several frames. It is
//! the single most conspicuous defect in this class of software, it is worst on
//! exactly the machines that are already slowest, and it cannot be fixed later
//! by making startup faster — a faster machine shortens the flash, it does not
//! remove it.
//!
//! The invariant is enforced structurally rather than by a check at the call
//! site. [`RevealStateMachine::reveal`] fails from any state below
//! `FirstFrameReady`, and the manager emits a show command **only** on the
//! transition it returns. There is no other way to reach visibility, so the
//! flash is not a mistake a caller can make.
//!
//! ## The sequence
//!
//! ```text
//! Created ──attach──▶ Attached ──first_frame──▶ FirstFrameReady ──reveal──▶ Revealed
//!    │                    │                            │                       │
//!    └────────────────────┴── reveal() → NotReady ──────┘                  is_visible()
//! ```
//!
//! | State | Means |
//! | --- | --- |
//! | `Created` | The surface is registered. No host window exists yet. |
//! | `Attached` | The host window exists and is bound to a display. Still hidden. |
//! | `FirstFrameReady` | The content has painted at least once. Still hidden. |
//! | `Revealed` | Visible. |
//!
//! ## Forward only
//!
//! There is no transition back. A revealed surface stays revealed for the rest
//! of its life, including when its display is unplugged: hiding it again would
//! be visual behaviour, and what should happen to a surface whose display left
//! is a layout decision this crate does not make. Detaching a surface changes
//! its *association* (`SurfaceRecord::monitor`) and leaves its reveal state
//! alone.
//!
//! Repeating a step that has already happened is not an error. A webview that
//! reloads signals its first frame again, and treating that as a fault — or, far
//! worse, as a reason to hide and re-show — would produce the flash on every
//! reload that the whole mechanism exists to prevent.

use core::fmt;

/// How far a surface has progressed toward being visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub enum RevealState {
    /// Registered. No host window yet.
    ///
    /// The default, so that a surface constructed by any route starts invisible.
    /// The safe end of this enum is the beginning of it.
    #[default]
    Created,
    /// The host window exists and is bound to a display. Hidden.
    Attached,
    /// The content has painted. Hidden.
    FirstFrameReady,
    /// Visible.
    Revealed,
}

impl RevealState {
    /// Whether a surface in this state is on screen.
    ///
    /// The single reader of the invariant. Everything that decides whether to
    /// show a window goes through here or through
    /// [`RevealStateMachine::reveal`]'s return value.
    #[must_use]
    pub const fn is_visible(self) -> bool {
        matches!(self, Self::Revealed)
    }

    /// Whether the content has painted at least once.
    #[must_use]
    pub const fn has_painted(self) -> bool {
        matches!(self, Self::FirstFrameReady | Self::Revealed)
    }
}

impl fmt::Display for RevealState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Created => "created",
            Self::Attached => "attached",
            Self::FirstFrameReady => "first-frame-ready",
            Self::Revealed => "revealed",
        };
        f.write_str(name)
    }
}

/// The step a caller attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevealStep {
    Attach,
    FirstFrame,
    Reveal,
}

impl fmt::Display for RevealStep {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Attach => "attach",
            Self::FirstFrame => "first-frame",
            Self::Reveal => "reveal",
        };
        f.write_str(name)
    }
}

/// Why a reveal step was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RevealError {
    /// The invariant. Something asked to show a surface that has not painted.
    ///
    /// Distinct from [`RevealError::OutOfOrder`] because it is the one failure
    /// this type exists to produce, and a caller — or a reader of a log — should
    /// not have to work out which ordering violation it was.
    #[error("a surface cannot be revealed from {state}: it has not painted a frame yet")]
    NotReady { state: RevealState },

    /// A step arrived before the one it depends on.
    #[error("{attempted} is not a valid step from {state}")]
    OutOfOrder {
        state: RevealState,
        attempted: RevealStep,
    },
}

/// What a step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevealOutcome {
    /// The state moved.
    Advanced { from: RevealState, to: RevealState },
    /// The step had already happened. Nothing changed, and that is not a fault.
    AlreadySatisfied { state: RevealState },
}

impl RevealOutcome {
    /// The transition, if there was one.
    #[must_use]
    pub const fn advanced(self) -> Option<(RevealState, RevealState)> {
        match self {
            Self::Advanced { from, to } => Some((from, to)),
            Self::AlreadySatisfied { .. } => None,
        }
    }

    /// Whether this transition is the one that puts a surface on screen.
    ///
    /// The only thing a caller should consult before issuing a show command.
    #[must_use]
    pub fn revealed_now(self) -> bool {
        matches!(
            self,
            Self::Advanced {
                to: RevealState::Revealed,
                ..
            }
        )
    }
}

/// One surface's progress toward visibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RevealStateMachine {
    state: RevealState,
}

impl RevealStateMachine {
    /// A surface that has just been registered.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            state: RevealState::Created,
        }
    }

    #[must_use]
    pub const fn state(self) -> RevealState {
        self.state
    }

    /// Whether the surface is on screen.
    #[must_use]
    pub const fn is_visible(self) -> bool {
        self.state.is_visible()
    }

    /// Whether [`RevealStateMachine::reveal`] would succeed.
    #[must_use]
    pub const fn can_reveal(self) -> bool {
        matches!(self.state, RevealState::FirstFrameReady)
    }

    /// The host window now exists and is bound to a display.
    ///
    /// Repeating this once the window exists is not an error: a surface may be
    /// re-associated to another display many times, and that changes where it
    /// is, not how far along it is.
    ///
    /// # Errors
    ///
    /// Never fails today. It returns `Result` because a later state — a window
    /// that failed to create, say — must be able to refuse, and widening the
    /// return type after callers exist is a breaking change.
    pub fn attach(&mut self) -> Result<RevealOutcome, RevealError> {
        match self.state {
            RevealState::Created => Ok(self.advance(RevealState::Attached)),
            state => Ok(RevealOutcome::AlreadySatisfied { state }),
        }
    }

    /// The content has painted.
    ///
    /// # Errors
    ///
    /// [`RevealError::OutOfOrder`] if no host window has been reported. A frame
    /// cannot be ready for a window nobody created, and accepting the claim
    /// would let a surface reach `FirstFrameReady` — and then visibility —
    /// without a window to be visible in.
    pub fn first_frame(&mut self) -> Result<RevealOutcome, RevealError> {
        match self.state {
            RevealState::Created => Err(RevealError::OutOfOrder {
                state: self.state,
                attempted: RevealStep::FirstFrame,
            }),
            RevealState::Attached => Ok(self.advance(RevealState::FirstFrameReady)),
            // A reload signals its first frame again. Treating that as a fault —
            // or as a reason to hide and re-show — produces the flash on every
            // reload that this whole mechanism exists to prevent.
            state => Ok(RevealOutcome::AlreadySatisfied { state }),
        }
    }

    /// Make the surface visible.
    ///
    /// # Errors
    ///
    /// [`RevealError::NotReady`] from any state below `FirstFrameReady`. **This
    /// is the invariant.** It is a returned error rather than a debug assertion
    /// because the failure it prevents is user-visible and the check must exist
    /// in release builds.
    pub fn reveal(&mut self) -> Result<RevealOutcome, RevealError> {
        match self.state {
            RevealState::Created | RevealState::Attached => {
                Err(RevealError::NotReady { state: self.state })
            }
            RevealState::FirstFrameReady => Ok(self.advance(RevealState::Revealed)),
            RevealState::Revealed => Ok(RevealOutcome::AlreadySatisfied { state: self.state }),
        }
    }

    fn advance(&mut self, to: RevealState) -> RevealOutcome {
        let from = self.state;
        self.state = to;
        RevealOutcome::Advanced { from, to }
    }
}
