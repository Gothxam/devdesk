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

## Amendment 1 — the band host windows actually use

**Recorded 2026-08-11, during the implementation this ADR unblocked.**

`DH-16` and `DH-17` cannot both hold in the `Wallpaper` band. A window parented
into `WorkerW` sits **behind** `SHELLDLL_DefView`, which covers the entire
desktop and receives every click on it. A wallpaper-parented host window
therefore receives no mouse input at all, and the input region `DH-17` computes
would have nothing to admit.

**`DH-23`. Desktop host windows attach to the `Desktop` band, not `Wallpaper`.**
On Windows that is a bottom-most top-level window (`HWND_BOTTOM`,
`WS_EX_NOACTIVATE`, `WS_EX_TOOLWINDOW`) — above the icons, below every ordinary
window. This satisfies "behind normal windows" as `DH-16` intends it, and it is
the only band where an interactive widget can live.

**`DH-24`.** `Wallpaper` remains implemented and remains `WorkerW` reparenting.
Everything §2 decided about it stands unchanged; it is the correct band for a
future animated-wallpaper surface, which is non-interactive by nature. `DH-1`
through `DH-8` are unaffected — they are about whether the technique is
permitted, not about which surfaces use it.

**`DH-25`.** `set_input_region` is meaningful only in the `Desktop` band. On
Windows it is `SetWindowRgn`, whose region clips **painting as well as input**,
so applying it to a full-monitor wallpaper surface would erase the wallpaper it
was meant to make click-through. Host windows are created whole-window
click-through (`DH-19`) and the region is applied only once a scene reports
interactive surfaces.

This narrows `DH-13`'s "parented to the single `WorkerW`" to "attached to the
desktop band". Nothing else in §5 changes: one host window per monitor, sized to
that monitor's bounds, positioned in virtual-screen coordinates.

---

**Decision recorded 2026-08-11. Effective on merge to `main`.**
