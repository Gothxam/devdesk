# ADR-0005 — Desktop Host Integration via WorkerW

> **Abstraction Level:** 📙 **Level 2 — Architecture**
> **Source of Truth:** `docs/` — Specifications

---

## Document Control

| Field | Value |
| --- | --- |
| **ADR ID** | `ADR-0005` |
| **Title** | Desktop host integration via WorkerW |
| **Status** | `ACCEPTED` |
| **Decision Date** | 2026-08-11 |
| **Deciders** | Lead Software Architect (owner), Security, Platform |
| **Resolves** | `Q-1` (`PRD.md` §25.2), `OQ-5` (`SYSTEM_ARCHITECTURE.md` Appendix D) |
| **Interprets** | `AC-SEC-7.2`, `AC-SEC-7.3` — narrows, never widens |
| **Implements** | `WD-8` attachment and degradation for Layer 0 |
| **Unblocks** | Stage 5C; the wallpaper layer in `SPRINT_1.md` §8 |
| **Reversal Cost** | **Low.** One backend method and one window-creation path. No persisted state, no schema, no contract change. Reverting means returning `Unsupported` from `attach_to_layer` and running in window mode. |

Numbers are allocated in decision order (`ADR-0004` `REG-1`).

---

## 1. Problem

DevDesk renders widgets *on the desktop*, below ordinary windows and above the
wallpaper. On Windows the only mechanism for that is reparenting a window into
`WorkerW`, an Explorer-owned container that sits behind the desktop icons.

`Q-1` left this open, and `SPRINT_1.md` §8 blocks it, because the technique
appears to collide with two Security criteria that never slip:

- **`AC-SEC-7.2`** — DevDesk does not inject into, hook, or modify any other process.
- **`AC-SEC-7.3`** — DevDesk does not modify Explorer, the taskbar, the Start menu, or any system-wide display or shell setting.

Nothing can be built until that reads one way or the other.

---

## 2. Decision — WorkerW attachment is permitted, within four bounds

**`DH-1`.** Reparenting a **DevDesk-owned window** into `WorkerW` does **not**
violate `AC-SEC-7.2` or `AC-SEC-7.3`.

The reasoning, against what each criterion actually prohibits:

| Prohibited | What the technique does |
| --- | --- |
| Inject code | Nothing. No DLL, no remote thread, no `WriteProcessMemory`. |
| Hook | Nothing. No `SetWindowsHookEx`, no subclassing of a foreign window. |
| Modify another process | It adds *our* window as a child in the USER32 window tree, which is a cross-process structure by design. No Explorer-owned window is altered, moved, subclassed, or destroyed. |
| Modify Explorer / shell settings | Nothing persists. `0x052C` asks Explorer to spawn a layer it creates natively; no registry value, no wallpaper setting, no taskbar state is written. On exit the child is gone; on Explorer restart the whole structure is rebuilt by Explorer. |

The criteria are about **influence that outlives us or reaches inside another
process**. Parenting our own window into a container the shell publishes is
neither. Where a reasonable reader could have taken `AC-SEC-7.3` to forbid it,
this ADR narrows the reading and the four bounds below are what make the
narrowing safe.

**`DH-2`. Only DevDesk-created windows may be reparented.** A window DevDesk did
not create is never passed to `SetParent`, never subclassed, never destroyed.

**`DH-3`. No persistent system state.** No registry write, no wallpaper change,
no shell setting. `AC-SEC-7.1`'s install/use/uninstall system-state diff must
show zero residue from attachment, and it is the test that enforces this.

**`DH-4`. Every step is failure-tolerant and reversible.** Any Win32 call in the
attachment sequence may fail; failure returns `Unsupported` (`DH-5`) and never
panics, retries in a loop, or leaves a half-attached window.

**`DH-5`. Attachment is observable.** `supports(WallpaperLayer)` answers before
anything is attempted, so the UI never offers desktop mode on a machine where it
cannot work (`XP-2`).

---

## 3. Degradation — what `WD-8` requires

**`DH-6`.** `attach_to_layer` returns `Unsupported { reason }` on any failure —
`Progman` absent, the `WorkerW` never appears, `SetParent` refused, or the
platform is not Windows. It never degrades silently (`XP-3`, `AP-15`).

**`DH-7`. The portable fallback is window mode.** §19.3's ladder asks whether a
fallback exists; it does, and it is the application window DevDesk already runs
in. Desktop mode is therefore an *enhancement*, never a requirement: a machine
that cannot attach gets the same widgets in a window, with the reason surfaced
in settings rather than a failure at startup.

**`DH-8`.** macOS and Linux report `Unsupported` for `WallpaperLayer` today.
macOS needs an `NSWindow` desktop level, Linux needs `wlr-layer-shell` and has
no path at all on GNOME Wayland — `XP-6` requires X11 and Wayland to answer
separately, and both answer here.

---

## 4. Explorer restart recovery

**`DH-9`.** Explorer restarting destroys `WorkerW` and orphans anything parented
to it. DevDesk **MUST** detect this and re-attach; a desktop that silently
vanishes until the next launch is indistinguishable from a crash.

**`DH-10`.** Detection is the `TaskbarCreated` registered window message, which
Explorer broadcasts to every top-level window when the shell restarts. Polling
for `Progman` is prohibited — it burns the idle budget (`B-4`) to discover
something the system already announces.

**`DH-11`.** Recovery re-runs attachment from the beginning, including
re-enumerating displays: an Explorer restart can coincide with a resolution
change, and re-attaching against stale topology places surfaces off-screen.

**`DH-12`.** Recovery is debounced on the same `WD-6` 250 ms window as hotplug,
and re-attachment that fails leaves DevDesk in window mode (`DH-7`) rather than
retrying indefinitely.

---

## 5. Multi-monitor

**`DH-13`. One host window per monitor**, each parented to the single `WorkerW`
and sized to that monitor's bounds — not one window spanning the virtual desktop.

Per-monitor windows because: DPI is per-monitor (`WD-2`), so one spanning window
would have a single scale factor and be wrong on a mixed-DPI desk; and a monitor
being unplugged then destroys exactly its own window rather than forcing a
resize of a shared one.

**`DH-14`.** Host windows are positioned in `WorkerW` client coordinates, which
are virtual-screen coordinates — a monitor left of the primary has a negative
origin, and the conversion is the display subsystem's existing physical space.

**`DH-15`.** A topology transaction adds, removes, and repositions host windows
to match. The window subsystem's existing association rules decide which surface
belongs to which monitor; this decides only where the *host* windows go.

---

## 6. Click-through

**`DH-16`.** A desktop host window **MUST NOT** take clicks where no interactive
surface sits. The desktop underneath — icons, right-click menu, selection
rectangle — has to keep working, and a full-screen window that swallowed every
click would break the desktop it is decorating.

**`DH-17`.** Input is admitted by **region**, not by per-click routing: the host
window's input region is the union of the rectangles of the surfaces the
composition scene reports as `interactive`. Recomputed when the scene changes.

A region rather than `WM_NCHITTEST` because the answer is already known — the
compositor computed it — and a per-click round trip into the webview would put
IPC on the input path (`AP-1`).

**`DH-18`.** Host windows are created `WS_EX_NOACTIVATE`: clicking a widget must
not steal focus from the user's editor. `WS_EX_TOOLWINDOW` keeps them out of
alt-tab.

**`DH-19`.** `set_click_through(window, true)` makes a whole window transparent
to input (`WS_EX_TRANSPARENT`) and is independent of layer attachment — it is
meaningful for any window on any platform that has one.

---

## 7. The `PlatformBackend` surface

**`DH-20`.** Exactly these additions. `WindowHandle` is opaque — the backend is
the only crate that knows it is an `HWND` (`DR-6`).

```rust
/// An OS window DevDesk created. Opaque outside `devdesk-platform`.
pub struct WindowHandle(u64);

/// The z-order band a window is attached to. §9.4.
pub enum SurfaceLayer { Wallpaper, Desktop, Normal, Overlay, System }

pub trait PlatformBackend {
    // … existing display methods …

    /// Attaches a DevDesk-created window to a band (DH-1, DH-2).
    fn attach_to_layer(&self, window: WindowHandle, layer: SurfaceLayer)
        -> Result<(), PlatformError>;

    /// Returns the window to an ordinary top-level window.
    fn detach_from_layer(&self, window: WindowHandle) -> Result<(), PlatformError>;

    /// Whole-window input transparency (DH-19).
    fn set_click_through(&self, window: WindowHandle, enabled: bool)
        -> Result<(), PlatformError>;

    /// Admits input only inside these rectangles (DH-17). Empty means none.
    fn set_input_region(&self, window: WindowHandle, regions: &[RawRect])
        -> Result<(), PlatformError>;

    /// Excludes the window from screen capture.
    fn exclude_from_capture(&self, window: WindowHandle, excluded: bool)
        -> Result<(), PlatformError>;

    /// Notifies on shell restart (DH-10).
    fn subscribe_shell_restart(&self, sink: ShellEventSink)
        -> Result<SubscriptionId, PlatformError>;
}
```

**`DH-21`.** New `PlatformFeature` members, each answerable before use (`XP-2`):
`WallpaperLayer`, `ClickThrough`, `InputRegion`, `CaptureExclusion`,
`ShellRestartEvents`.

**`DH-22`.** `attach_to_layer` accepts every `SurfaceLayer` in its signature and
returns `Unsupported` for the ones a platform cannot do. The enum is not
narrowed per platform, because a caller asking "can this machine do wallpaper"
must get an answer rather than a compile error.

---

## 8. Consequences

- **Desktop mode is optional everywhere.** `DH-7` makes window mode the floor, so
  no platform blocks on this and `AC-OFF-1.1`/`AC-FRE-1.1` are unaffected.
- **`AC-SEC-7.1`'s diff test gains a case:** attach, restart Explorer, exit, and
  assert zero residue. `DH-3` is only as good as that test.
- **One more failure mode to report honestly.** A machine where attachment fails
  shows widgets in a window and says why, rather than showing nothing.

---

## 9. Review Triggers

| ID | Trigger | Re-opens |
| --- | --- | --- |
| **T-1** | Windows changes or removes the `0x052C`/`WorkerW` behaviour | `DH-1`, `DH-6` — the fallback already exists, so this is a degradation not a break |
| **T-2** | A technique is proposed that touches a window DevDesk did not create | `DH-2` — and the answer is expected to be no |
| **T-3** | Anything proposes persisting shell state to make attachment stick | `DH-3`, `AC-SEC-7.1` |
| **T-4** | macOS or Linux desktop attachment is scheduled | `DH-8`, `XP-6` |
| **T-5** | Input routing is proposed via `WM_NCHITTEST` or IPC | `DH-17`, `AP-1` |
| **T-6** | A plugin requests the wallpaper layer | `WD-7`, `WD-9` — grant policy is out of scope here and needs its own decision |

---

## 10. Related Documents

| Document | Relationship |
| --- | --- |
| [`ADR-0001`](./ADR-0001-system-architecture.md) | Parent; `§9.4` layers and `WD-8` attachment |
| [`ADR-0004`](./ADR-0004-display-topology-identity-and-transaction-model.md) | Supplies the topology `DH-11`/`DH-15` re-attach against |
| [`PRD.md`](../product/PRD.md) §25.2 | Owns `Q-1`, resolved here |
| [`MVP_ACCEPTANCE_MATRIX.md`](../product/MVP_ACCEPTANCE_MATRIX.md) | `AC-SEC-7.1`…`7.3`, interpreted in §2 |

---

## Amendment 1 — the band host windows use

**Recorded 2026-08-11. Revised the same day, after seeing it on a screen.**

The first draft of this amendment moved host windows to the `Desktop` band, on
the argument that a `WorkerW`-parented window sits behind `SHELLDLL_DefView` and
can therefore never be clicked. That is true, and it is the wrong conclusion.

DevDesk paints a **whole-monitor background**. In the `Desktop` band that
background covered the user's desktop icons with an opaque surface that clicks
passed straight through: the icons were still there and still clickable, and
invisible. The band that cannot take input is the band that belongs behind the
icons, which is the one the wallpaper goes in.

**`DH-23`. Desktop host windows attach to the `Wallpaper` band** — reparented
into `WorkerW`, behind the icons. `DH-16` then holds by construction rather than
by a region that has to be kept correct: every click on the desktop reaches the
desktop, because DevDesk is not in front of it.

**`DH-24`. The cost is that widgets are not clickable, and it is accepted.**
Every widget DevDesk ships today is read-only. The `Desktop` band stays
implemented — bottom-most, `WS_EX_NOACTIVATE`, `WS_EX_TOOLWINDOW` — and a
surface that needs input moves to it when there is one to justify the move.

**`DH-25`.** `set_input_region` is meaningful only in the `Desktop` band. On
Windows it is `SetWindowRgn`, whose region clips **painting as well as input**,
so applying it to a full-monitor wallpaper surface would erase the wallpaper it
was meant to make click-through. Host windows are whole-window click-through
(`DH-19`); the region waits for the band that can use it.

Nothing in §5 changes: one host window per monitor, sized to that monitor's
bounds, positioned in virtual-screen coordinates.

---

## Amendment 2 — what validation forced

**Recorded 2026-08-11, from running it on Windows 11 26200 and restarting Explorer.**

**`DH-26`. The wallpaper `WorkerW` is not in the same place on every build.**
Windows 10 promotes it to a top-level *sibling* of the window owning
`SHELLDLL_DefView`; Windows 11 keeps it a *child of `Progman`*, listed after
`SHELLDLL_DefView`. Both are searched, and a candidate owning `SHELLDLL_DefView`
is rejected — that one holds the icons, and parenting into it puts DevDesk in
front of them. A build matching neither shape degrades (`DH-6`) rather than
guessing: a Windows 11 desktop also carries a dozen unrelated 133×38 top-level
`WorkerW` windows, and picking one would attach the desktop to something the
size of a tooltip.

**`DH-27`. A host window's label carries a generation.** Explorer destroys host
windows without going through Tauri, so Tauri's registry keeps the label of a
window that no longer exists and refuses to reuse it — every re-attach after a
restart failed with *"a webview with label … already exists"*. Nothing can clear
that entry from outside the framework. Each rebuilt desktop therefore takes the
next generation and a name nothing holds.

**`DH-28`. The retry budget spans a real restart, and abandoning still leaves a
window.** `TaskbarCreated` arrives when the *taskbar* is created; the desktop's
`WorkerW` is rebuilt seconds later. `DH-12`'s 250 ms remains the coalescing
window, but the attempts after it back off — 0.25 s, 0.5 s, 1 s, 2 s, 4 s, 8 s —
so the budget is about sixteen seconds and still bounded. Two attempts 250 ms
apart gave up while the shell was still starting and reported a machine that
could not attach when nobody had waited.

`DH-7` is not satisfied by *deciding* on window mode. Abandoning recovery must
**create the window**, or the fallback is a running process showing nothing.

**`DH-29`. A window created hidden must not wait for its own first frame.**
The shell reports its first frame from `requestAnimationFrame`, and Chromium
stops the compositor for a hidden page: the frame needs the compositor, the
compositor needs the window, and the window is waiting for the frame. Reveal is
therefore driven by `PageLoadEvent::Finished`, which the webview host delivers
regardless of visibility and only after the document has parsed — so
`AC-FRE-1.1` still holds. Revealing a window also rewrites its extended style,
so everything attachment set is re-asserted immediately after the show.

---

**Decision recorded 2026-08-11. Effective on merge to `main`.**
