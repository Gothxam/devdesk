/**
 * `@devdesk/contracts` — public surface.
 *
 * The IPC contract is **generated from the Rust command signatures**, never
 * hand-written on both sides (GEN-1, DD-003). A hand-maintained mirror drifts
 * silently, and silent drift at a trust boundary is a security problem rather
 * than a typing inconvenience (AP-13).
 *
 * Regenerate: `cargo run -p devdesk-app --bin export-contract`
 */

export * from './generated/contract';

/**
 * Hand-written schemas, as distinct from the generated IPC surface above.
 *
 * The distinction matters: everything from `./generated/` is derived from Rust
 * signatures and regenerating it is the only legal way to change it (GEN-1).
 * What follows is authored here because it describes an artifact the *user*
 * writes — a manifest — which no Rust signature can generate.
 */
export * from './widget';

/**
 * Toggles desktop host interactivity (Edit Mode bridge).
 * Safely invokes Tauri command desktop_set_edit_mode when running in native desktop host.
 */
export async function invokeDesktopSetEditMode(enabled: boolean): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('desktop_set_edit_mode', { enabled });
  } catch {
    // browser mode fallback
  }
}



