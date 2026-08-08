//! The Tauri half of the window subsystem.
//!
//! Every line of Tauri window code in the project is here. `devdesk-core`
//! decides what should happen to a window and produces a `WindowCommand`; this
//! executes it. The split is what lets the whole subsystem — association, the
//! reveal sequence, the no-flash invariant — be tested without a display server.
//!
//! DR-7 keeps this crate thin, and it is: no policy, no decisions, one match.

use devdesk_core::window::{WindowCommand, WindowCommandSink, WindowId};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Executes window commands against Tauri.
pub struct TauriSink {
    app: AppHandle,
}

impl TauriSink {
    #[must_use]
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

/// The Tauri window label for a surface's window.
///
/// Derived from the [`WindowId`] rather than the surface identity. A label names
/// a live window, which is exactly what a `WindowId` is — process-local, unique,
/// never reused. Building it from a `SurfaceId` would need sanitising (labels
/// take a restricted character set), and sanitising can map two identities onto
/// one label, which would point two surfaces at one window.
fn label_for(window: WindowId) -> String {
    format!("surface-{}", window.get())
}

impl WindowCommandSink for TauriSink {
    fn execute(&self, command: &WindowCommand) -> Result<(), String> {
        match command {
            WindowCommand::CreateHidden { window, .. } => {
                let label = label_for(*window);

                // `.visible(false)` is the whole of AC-FRE-1.1 on this side.
                // Tauri's default is visible, so omitting this line would create
                // the flash — which is why the command carries no `visible`
                // field for a caller to get wrong.
                WebviewWindowBuilder::new(&self.app, &label, WebviewUrl::App("index.html".into()))
                    .visible(false)
                    .build()
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            }

            WindowCommand::Show { window, .. } => self
                .app
                .get_webview_window(&label_for(*window))
                .ok_or_else(|| format!("no window labelled {}", label_for(*window)))?
                .show()
                .map_err(|error| error.to_string()),

            WindowCommand::Destroy { window, .. } => {
                match self.app.get_webview_window(&label_for(*window)) {
                    Some(existing) => existing.destroy().map_err(|error| error.to_string()),
                    // Already gone. Teardown ordering is not something a caller
                    // should have to reason about during shutdown.
                    None => Ok(()),
                }
            }
        }
    }
}
