# macOS App: Working-State Visualization (Sub-Project C)

**Date:** 2026-07-04
**Status:** Approved (design)
**Scope:** `apps/macos` only. `@verba/core` and the VS Code extension are unchanged.

Sub-Project C of three (order A → C → B). A (config system) is done. B (settings UI) follows.

## Problem

The macOS app runs the whole dictation flow invisibly. The user's very first report this
session was "nothing happens" — the hotkey, recording, transcription, and paste all worked,
but there was no feedback. Competitors (Wispr Flow, Superwhisper) show a floating pill with
recording/processing state; native macOS menu-bar apps change their tray icon. Verba has
neither.

## Goal

Two coordinated, always-visible state surfaces driven by the dictation flow:

1. **Menu-bar (tray) icon** reflects state via **both** an icon swap and tooltip/title text.
2. **Floating HUD pill** (bottom-center) shows a per-state icon + color + label while working,
   and hides when idle.

Both are driven by a single discrete state emitted by the controller.

### States

`idle | recording | transcribing | processing`

| State | HUD | Tray tooltip / title | Accent |
|---|---|---|---|
| `idle` | hidden | "Verba — bereit" / (no title) | — |
| `recording` | 🎙 "Aufnahme …" | "Verba — Aufnahme" / "●" | red |
| `transcribing` | ⏺ "Transkribiere …" | "Verba — Transkribiere" / "…" | amber |
| `processing` | ⚙ "Verarbeite mit Claude …" | "Verba — Verarbeite" / "…" | blue |

(Exact glyphs/labels are finalized in the plan; the table fixes intent.)

## The critical constraint (from this session)

The paste step synthesizes ⌘V into the **frontmost** app. Any Verba window that becomes
**focused** steals that focus and the paste lands in Verba instead of the target (root cause of
the earlier "paste doesn't work"). Therefore:

> **The HUD window MUST be non-activating and click-through.** It never takes keyboard focus
> and never intercepts mouse events. `focus:false`, `skipTaskbar:true`, `decorations:false`,
> `transparent:true`, `alwaysOnTop:true`, plus `setIgnoreCursorEvents(true)`. Success is
> verified by: paste still works while the HUD is visible.

## Design

### 1. Discrete state seam (frontend)

- New type `DictationState = 'idle' | 'recording' | 'transcribing' | 'processing'`.
- `ControllerUi` gains `setState(state: DictationState): void` (alongside the existing
  `setPhase`, which still drives the hidden main-window text). The controller calls `setState`
  at its four transitions (recording start, transcribing, processing, idle — both success and
  error paths reach idle). `controller.test.ts`'s fake UI adds a `setState` stub.

Rationale: a discrete state is cleaner than string-matching the display phrases and gives both
surfaces one source of truth.

### 2. State → presentation mapping (pure, testable)

A pure function `presentationFor(state): { hudVisible, hudIcon, hudLabel, hudAccent, trayTooltip, trayTitle, trayIcon }` in a new `apps/macos/src/visualization/statePresentation.ts`. Unit-tested exhaustively (one assertion set per state). Both the tray adapter and the HUD consume its output, so the mapping lives in exactly one place.

### 3. Tray feedback (Rust)

- New command `set_tray_state(state: String)`: looks up `tray_by_id("verba-tray")` and sets
  `set_tooltip`, `set_title` (macOS shows a short string beside the icon), and `set_icon` to
  the matching state icon.
- Four monochrome **template** menu-bar icons (auto-adapt to light/dark) under
  `src-tauri/icons/state/` (`idle|recording|transcribing|processing`). Generation method
  (Pillow/ImageMagick/committed source) is resolved in the plan; they are simple, distinct
  shapes. Registered as template images so macOS tints them correctly.

### 4. HUD window

- A second Tauri window `hud`, declared in `tauri.conf.json`: `transparent:true`,
  `decorations:false`, `alwaysOnTop:true`, `focus:false`, `skipTaskbar:true`, `shadow:false`,
  `resizable:false`, `visible:false`, small fixed size (≈ 300×56). Added to the capability
  `windows` list.
- Its own minimal entry `hud.html` + `src/hud/hud.ts` (registered as a second Vite input),
  rendering a rounded pill: state icon + colored accent + label. Pure CSS spinner/pulse; no
  external assets.
- On creation the frontend calls `setIgnoreCursorEvents(true)` on the hud window (click-through).

### 5. Visualization adapter (frontend) + wiring

- `apps/macos/src/visualization/visualization.ts` exports `setState(state)` that:
  1. `invoke('set_tray_state', { state })`.
  2. For `idle`: hide the hud window. For others: position it bottom-center (compute from
     `currentMonitor()` size and scale factor at show time), emit a `hud:state` Tauri event with
     the state (the hud webview subscribes and re-renders via `presentationFor`), and show it
     **without focus**.
- `wiring.ts` adds `setState` to the `ui` deps, backed by this adapter. `main.ts` initializes
  the hud window's click-through once at startup.

### Data flow

```
controller transition → ui.setState(state)
  ├─ invoke set_tray_state(state) → Rust: tray icon + tooltip + title
  └─ hud: idle → hide ; else → position bottom-center, emit hud:state, show (no focus)
                                   └─ hud.html subscribes → presentationFor(state) → render pill
```

## Error handling

- Every visualization call is best-effort: a failed `invoke`/window op is caught and logged,
  never propagated — visualization must never break the dictation flow (same principle as the
  notifier).
- If the hud window is unavailable, tray feedback still works, and vice versa.

## Testing

- `statePresentation.ts`: pure unit tests (mocha/sinon) — one per state asserting
  `hudVisible`, icon, label, accent, tooltip, title.
- Controller: extend `controller.test.ts` to assert `ui.setState` is called with `'recording'`,
  `'transcribing'`, `'processing'`, and `'idle'` at the right transitions (both success and
  error paths reach `'idle'`).
- Tray/HUD/adapter glue is Tauri-bound (no unit test); covered by manual verification.

## Manual verification

1. Dictate → tray icon + tooltip/title change idle→recording→transcribing→processing→idle;
   the HUD pill appears bottom-center with the right icon/color/label and hides at the end.
2. **Focus safety:** with the HUD visible, dictate into Sublime → the cleaned text still pastes
   into Sublime (the HUD never stole focus). This is the gating check.
3. The HUD is click-through: clicking where it sits activates the window beneath it.

## Non-goals (this sub-project)

- No live audio waveform (deferred; the user chose icon+pill without waveform).
- No settings to toggle/position the HUD (that is Sub-Project B / future).
- No animation beyond a simple CSS spinner/pulse.
