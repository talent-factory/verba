# Overview & Status

!!! warning "Public Beta"
    The macOS app is a **Public Beta**. It is functional and used daily during development, but there is no packaged build yet — you run it from source. Expect rough edges.

Verba's macOS app brings the same dictation pipeline as the VS Code extension to the entire operating system: **system-wide dictation into any app — press a hotkey, speak, and Verba pastes clean text wherever your cursor is.** Email, chat, browser forms, notes — anywhere you can paste, you can dictate.

## How it works

1. Press the global hotkey (`Ctrl+Alt+D` by default) to start recording.
2. Speak — a floating HUD near the bottom of the screen shows the current state.
3. Press the hotkey again to stop. Verba transcribes the recording with **Deepgram Nova-3**.
4. The transcript is refined by **Claude** using your active template (filler-word removal, course-correction handling, voice commands, glossary/expansions — the same post-processing as the VS Code extension).
5. The cleaned text is pasted into whichever app is currently frontmost.

See [Usage](usage.md) for the full interaction details and [Configuration](configuration.md) for how to change language, glossary, templates, and more.

## Status

- **Functional**, actively developed, no packaged `.dmg` build published yet.
- Run it via `just macos-dev` — see [Installation](installation.md) for build-from-source setup.
- Requires macOS; Microphone and Accessibility permissions (see [Permissions](permissions.md)).

<!-- TODO: add macOS menu-bar / HUD screenshot (images/screenshots/macos-hud.png) -->

## Next Steps

- [Installation](installation.md) — build and run from source
- [Usage](usage.md) — hotkey, tray menu, and HUD states
- [Configuration](configuration.md) — `~/.config/verba/config.json`
- [Permissions](permissions.md) — Microphone and Accessibility
