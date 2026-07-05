# Permissions

The macOS app needs two macOS permissions to function: **Microphone** (to capture your dictation) and **Accessibility** (to paste the result into other apps).

## Microphone

Verba captures audio natively via `cpal` (no ffmpeg on macOS). The first time it tries to record, macOS shows the standard TCC microphone-access prompt, using the description declared in `apps/macos/src-tauri/Info.plist`:

> "Verba needs microphone access to record dictation for transcription."

**Without this permission:** recording fails outright — there is no fallback, since dictation is impossible without audio.

If you previously denied the prompt, grant it manually: **System Settings → Privacy & Security → Microphone**, then enable Verba.

## Accessibility

Pasting the cleaned transcript into the frontmost app is done via a synthetic ⌘V keystroke (clipboard write + a posted key event), which macOS only allows for processes trusted for **Accessibility**.

Verba checks this passively before every paste with the `has_accessibility_permission` command (wraps `AXIsProcessTrusted()` — a check that never triggers the system's own permission dialog on its own). If the permission is missing:

1. Verba's window is shown with an onboarding message: *"Verba needs Accessibility permission to paste into other apps. Grant it in System Settings, then press the hotkey again to dictate."*
2. An **"Open System Settings"** button calls the `open_accessibility_settings` command, which deep-links straight to **System Settings → Privacy & Security → Accessibility** (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`).
3. The transcript is also shown in the window so it isn't lost while you go grant the permission.
4. Once Accessibility is granted, press the hotkey again — the next dictation pastes normally.

**Without this permission:** transcription still runs, but nothing is pasted anywhere. The transcript always stays visible in Verba's window as a fallback so you can copy it manually.

## Summary

| Permission | Used for | Without it |
|------------|----------|------------|
| Microphone | Recording your dictation | Recording fails — no audio can be captured |
| Accessibility | Synthetic ⌘V paste into the frontmost app | Nothing gets pasted automatically; the transcript is shown in-app instead |

## Next Steps

- [Usage](usage.md) — the full hotkey and tray-menu flow
- [Configuration](configuration.md) — language, glossary, expansions, templates
