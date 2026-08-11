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
 * The desktop's interaction state, as the native host owns it.
 *
 * **The host is the source of truth, not the shell.** In desktop mode the
 * window the shell runs in is click-through and sits beneath Explorer's icon
 * layer, so it receives no clicks and can hold no keyboard focus: every in-page
 * trigger is unreachable from the state it is meant to leave. The way in is a
 * system-wide hotkey handled natively, which means the shell learns about the
 * change rather than causing it.
 *
 * A shell that pushed its own initial state on mount — as this one used to —
 * asserted "not editing" on every reload, so a reloaded webview silently left
 * edit mode and raced the hotkey that had just entered it.
 *
 * All three functions degrade to a no-op in a plain browser, where there is no
 * host to ask and the page is interactive anyway.
 */

/** Asks the host to enter or leave edit mode. */
export async function invokeDesktopSetEditMode(enabled: boolean): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('desktop_set_edit_mode', { enabled });
  } catch {
    // No host: a browser page is already interactive, so there is nothing this
    // could have changed.
  }
}

/**
 * Reads the mode the host is in.
 *
 * Returns `undefined` when there is no host to ask, which is different from
 * `false`: the caller keeps whatever it had rather than being told the desktop
 * is ambient by a runtime that has no desktop.
 */
export async function readDesktopEditMode(): Promise<boolean | undefined> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('desktop_interaction_state');
  } catch {
    return undefined;
  }
}

/**
 * Subscribes to mode changes the shell did not initiate.
 *
 * The hotkey is exactly that: handled entirely natively, so without this the UI
 * would still read "Edit Layout" over a desktop that had become editable.
 *
 * Returns a function that ends the subscription, or `undefined` where there is
 * no host to subscribe to.
 */
export async function onDesktopEditModeChanged(
  handler: (editing: boolean) => void,
): Promise<(() => void) | undefined> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const stop = await listen<boolean>('devdesk://interaction', (event) => {
      handler(event.payload);
    });
    return stop;
  } catch {
    return undefined;
  }
}



