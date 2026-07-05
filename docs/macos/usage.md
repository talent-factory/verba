# Usage

Verba runs as a **menu-bar accessory app** — it has no Dock icon and no visible main window during normal use. You interact with it through the global hotkey, the menu-bar tray icon, and a small floating HUD.

## Dictating

1. Press **`Ctrl+Alt+D`** anywhere on the system to start recording (this is the default hotkey; it isn't yet user-configurable).
2. Speak. The HUD near the bottom of the screen shows "Recording…".
3. Press **`Ctrl+Alt+D`** again to stop. The HUD updates through "Transcribing…" and "Processing…" while Deepgram transcribes the audio and Claude cleans it up using your active template.
4. The cleaned text is pasted automatically into whatever app was frontmost when you started recording (via clipboard + synthetic ⌘V — see [Permissions](permissions.md)).

A hotkey press while idle starts recording; a press while recording stops and processes it; presses while transcribing or processing are ignored so a stray double-press can't interrupt a run already in flight.

If Verba can't paste (e.g. Accessibility permission not yet granted, or the paste itself fails), the transcript is shown in Verba's window instead so you never lose it.

## The Tray Menu

Click the Verba icon in the menu bar to open the tray menu:

| Item | Purpose |
|------|---------|
| **Transkriptionssprache** | Language passed to Deepgram for transcription |
| **Cleanup-Sprache (Claude)** | Language Claude uses for post-processing |
| **Provider** | Transcription provider (currently Deepgram; a local whisper.cpp option is listed but disabled — not yet wired on macOS) |
| **Vorlage** | Template picker — choose the active post-processing template |
| **Konfiguration öffnen…** | Opens `~/.config/verba/config.json` in your default editor (creating it if it doesn't exist) |
| **Konfiguration neu laden** | Reloads the config file and re-applies it live, without restarting the app |
| **Quit Verba** | Quits the app |

Changing a setting in the tray menu writes it straight to `~/.config/verba/config.json` and reloads it — see [Configuration](configuration.md) for the full schema if you'd rather edit the file directly.

## The HUD

A small, non-focusable pill appears near the bottom of the screen whenever Verba is recording, transcribing, or processing, and hides again once idle. It never steals keyboard focus (so your synthetic-paste target stays correct) and never intercepts clicks. The menu-bar icon and tooltip mirror the same state.

## Next Steps

- [Configuration](configuration.md) — full config schema and templates
- [Permissions](permissions.md) — what Microphone and Accessibility are used for
