//! Accessibility permission check, System Settings deep-link, and the real
//! paste mechanism (M3). `paste_text` pastes via clipboard + synthetic ⌘V:
//! AX value insertion was evaluated and dropped (unproven FFI, two code
//! paths, little benefit) — see
//! docs/superpowers/specs/2026-07-03-macos-paste-cleanup-design.md.

use std::{thread, time::Duration};

use arboard::Clipboard;
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

/// URL that opens System Settings directly on the Accessibility pane.
const ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/// Virtual keycode for the `V` key (kVK_ANSI_V in Carbon's Events.h).
const KEY_V: CGKeyCode = 9;

/// Virtual keycode `Return` (kVK_Return in Carbon's Events.h).
const KEY_RETURN: CGKeyCode = 0x24;

/// Wait after writing the pasteboard so the write has propagated before the
/// synthetic ⌘V fires.
const PASTEBOARD_PROPAGATION_DELAY: Duration = Duration::from_millis(50);

/// Wait after ⌘V before restoring the previous clipboard content: the target
/// app reads the pasteboard asynchronously, and restoring too early makes it
/// paste the old content instead of the transcript.
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(300);

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    /// True when the frontmost app has **Secure Event Input** enabled (e.g. a
    /// terminal with "Secure Keyboard Entry" on, or any password field). While
    /// active, the OS silently swallows synthetic key events — so a synthetic ⌘V
    /// never reaches the app. `HIToolbox`/Carbon's `IsSecureEventInputEnabled`.
    fn IsSecureEventInputEnabled() -> bool;
}

/// The result of a paste attempt, so the frontend can distinguish the normal
/// paste from the secure-input case where the transcript was left on the
/// clipboard for the user to paste manually. Serializes to `"pasted"` /
/// `"secure-input"`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasteOutcome {
    Pasted,
    SecureInput,
}

/// Whether this process is trusted for Accessibility (required to paste into
/// other apps). This is a passive check — unlike
/// `AXIsProcessTrustedWithOptions`, it never triggers the system's own
/// permission prompt; Verba shows its own onboarding UI instead.
#[tauri::command]
pub fn has_accessibility_permission() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Opens System Settings on the Accessibility pane so the user can grant
/// permission to Verba.
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    let status = std::process::Command::new("open")
        .arg(ACCESSIBILITY_SETTINGS_URL)
        .status()
        .map_err(|e| e.to_string())?;

    if !status.success() {
        return Err(format!("`open` exited with {status}"));
    }
    Ok(())
}

/// Pastes `text` into the frontmost app: saves the current clipboard text,
/// writes `text`, synthesizes ⌘V, and restores the previous clipboard.
///
/// Non-text clipboard content (images, files) is not restored in v1 — a
/// documented limitation. Requires the Accessibility permission; the caller
/// gates on `has_accessibility_permission` first (without it the synthetic
/// keystroke is silently dropped by the OS).
///
/// Async so the two sleeps (~350ms total) run on a blocking-pool thread and
/// never stall Tauri's main thread.
///
/// Returns [`PasteOutcome::SecureInput`] (without pasting) when Secure Event
/// Input is active: the synthetic ⌘V would be swallowed and the restore would
/// then lose the transcript, so the text is left on the clipboard for the user
/// to paste manually and the caller is told to surface that.
#[tauri::command]
pub async fn paste_text(text: String) -> Result<PasteOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || paste_text_blocking(&text))
        .await
        .map_err(|e| format!("Paste failed: {e}"))?
}

/// The slice of clipboard behavior the paste flow needs. Abstracted over
/// `arboard::Clipboard` so the save/restore sequencing can be tested against an
/// in-memory fake — the real system pasteboard is a single global resource and
/// concurrent test access to it races.
trait TextClipboard {
    fn get_text(&mut self) -> Option<String>;
    fn set_text(&mut self, text: &str) -> Result<(), String>;
}

impl TextClipboard for Clipboard {
    fn get_text(&mut self) -> Option<String> {
        Clipboard::get_text(self).ok()
    }
    fn set_text(&mut self, text: &str) -> Result<(), String> {
        Clipboard::set_text(self, text).map_err(|e| e.to_string())
    }
}

fn paste_text_blocking(text: &str) -> Result<PasteOutcome, String> {
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Paste failed: clipboard unavailable: {e}"))?;
    let secure_input = unsafe { IsSecureEventInputEnabled() };
    paste_via_clipboard(&mut clipboard, text, secure_input, synthesize_cmd_v)
}

/// Clipboard save → write `text` → run `keystroke` (the synthetic ⌘V) → restore
/// the previous clipboard. The restore runs on **every** normal path, so a
/// failed keystroke never leaves the transcript stranded on the clipboard with
/// the user's previous content lost. `clipboard`, `secure_input`, and
/// `keystroke` are injected so this sequencing is unit-testable without a real
/// pasteboard, HID event, or Secure Event Input state.
///
/// When `secure_input` is true the synthetic ⌘V would be silently swallowed by
/// the OS. Firing it and then restoring the previous clipboard would lose the
/// dictated text with no paste to show for it. Instead we leave the transcript
/// on the clipboard, skip the keystroke, skip the restore, and return
/// [`PasteOutcome::SecureInput`] so the caller can prompt the user to paste.
fn paste_via_clipboard(
    clipboard: &mut impl TextClipboard,
    text: &str,
    secure_input: bool,
    keystroke: impl FnOnce() -> Result<(), String>,
) -> Result<PasteOutcome, String> {
    if secure_input {
        // Leave the transcript on the clipboard; do NOT restore the previous
        // content and do NOT fire the (would-be-swallowed) keystroke.
        clipboard
            .set_text(text)
            .map_err(|e| format!("Paste failed: could not write clipboard: {e}"))?;
        return Ok(PasteOutcome::SecureInput);
    }

    let previous = clipboard.get_text();

    clipboard
        .set_text(text)
        .map_err(|e| format!("Paste failed: could not write clipboard: {e}"))?;
    thread::sleep(PASTEBOARD_PROPAGATION_DELAY);

    let pasted = keystroke();
    // Only wait for the target app to consume the pasteboard if the keystroke
    // actually fired; on failure restore immediately.
    if pasted.is_ok() {
        thread::sleep(CLIPBOARD_RESTORE_DELAY);
    }

    if let Some(prev) = previous {
        if let Err(e) = clipboard.set_text(&prev) {
            // A failed restore is log-only — the paste (if any) already happened.
            eprintln!("[Verba] Could not restore previous clipboard content: {e}");
        }
    }
    pasted.map(|()| PasteOutcome::Pasted)
}

/// Posts a synthetic ⌘V key-down/key-up pair to the HID event tap.
fn synthesize_cmd_v() -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Paste failed: could not create event source".to_string())?;

    for key_down in [true, false] {
        let event = CGEvent::new_keyboard_event(source.clone(), KEY_V, key_down)
            .map_err(|_| "Paste failed: could not create ⌘V event".to_string())?;
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
    Ok(())
}

/// Synthesizes a single Return keystroke into the frontmost app. Used as the
/// submit step of the paste-fallback delivery path (the herdr path submits
/// itself via `herdr pane send-keys`).
#[tauri::command]
pub async fn press_enter() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
            .map_err(|_| "press_enter: could not create event source".to_string())?;
        for key_down in [true, false] {
            let event = CGEvent::new_keyboard_event(source.clone(), KEY_RETURN, key_down)
                .map_err(|_| "press_enter: could not create Return event".to_string())?;
            event.post(CGEventTapLocation::HID);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("press_enter join failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use arboard::Clipboard;

    #[test]
    fn accessibility_settings_url_targets_the_privacy_pane() {
        assert_eq!(
            ACCESSIBILITY_SETTINGS_URL,
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        );
    }

    #[test]
    fn has_accessibility_permission_does_not_panic() {
        // Real permission state depends on the machine running the test; the
        // meaningful thing to assert is that the FFI call completes cleanly.
        let _: bool = has_accessibility_permission();
    }

    #[test]
    fn paste_outcome_serializes_to_the_exact_wire_strings() {
        // Locks the wire contract `wiring.ts`'s
        // `invoke<'pasted' | 'secure-input'>('paste_text', ...)` depends on.
        assert_eq!(
            serde_json::to_string(&PasteOutcome::SecureInput).unwrap(),
            "\"secure-input\""
        );
        assert_eq!(
            serde_json::to_string(&PasteOutcome::Pasted).unwrap(),
            "\"pasted\""
        );
    }

    #[test]
    fn key_v_matches_the_ansi_virtual_keycode() {
        // kVK_ANSI_V from Carbon's Events.h; ⌘V is synthesized with this code.
        assert_eq!(KEY_V, 9);
    }

    #[test]
    fn restore_waits_longer_than_pasteboard_propagation() {
        // Restoring before the target app has read the pasteboard would paste
        // the OLD clipboard content; the restore delay must dominate.
        assert!(CLIPBOARD_RESTORE_DELAY > PASTEBOARD_PROPAGATION_DELAY);
    }

    /// In-memory `TextClipboard` so the save/restore logic is tested without the
    /// real system pasteboard (a global resource that races across test threads).
    struct FakeClipboard {
        text: Option<String>,
    }

    impl TextClipboard for FakeClipboard {
        fn get_text(&mut self) -> Option<String> {
            self.text.clone()
        }
        fn set_text(&mut self, text: &str) -> Result<(), String> {
            self.text = Some(text.to_string());
            Ok(())
        }
    }

    #[test]
    fn restores_previous_clipboard_after_a_successful_keystroke() {
        let mut clipboard = FakeClipboard { text: Some("previous-value".to_string()) };

        // A no-op stands in for the synthetic ⌘V.
        let outcome = paste_via_clipboard(&mut clipboard, "dictated-text", false, || Ok(())).unwrap();

        assert!(matches!(outcome, PasteOutcome::Pasted));
        assert_eq!(clipboard.text.as_deref(), Some("previous-value"));
    }

    #[test]
    fn restores_previous_clipboard_even_when_the_keystroke_fails() {
        let mut clipboard = FakeClipboard { text: Some("previous-value".to_string()) };

        // The bug this guards: an early `?` return skipping the restore, leaving
        // "dictated-text" on the clipboard and the user's "previous-value" lost.
        let result = paste_via_clipboard(&mut clipboard, "dictated-text", false, || Err("keystroke boom".to_string()));

        assert!(result.is_err());
        assert_eq!(clipboard.text.as_deref(), Some("previous-value"));
    }

    #[test]
    fn leaves_the_transcript_when_there_was_no_previous_text() {
        // Documents the v1 limitation: a non-text/empty clipboard has nothing to
        // restore, so the transcript stays on the pasteboard.
        let mut clipboard = FakeClipboard { text: None };

        let outcome = paste_via_clipboard(&mut clipboard, "dictated-text", false, || Ok(())).unwrap();

        assert!(matches!(outcome, PasteOutcome::Pasted));
        assert_eq!(clipboard.text.as_deref(), Some("dictated-text"));
    }

    #[test]
    fn secure_input_leaves_transcript_and_never_restores_or_types() {
        // Secure Event Input (e.g. a terminal with "Secure Keyboard Entry" on)
        // silently swallows the synthetic ⌘V. Restoring the previous clipboard
        // then loses the dictation entirely. Under secure input we must instead
        // leave the transcript on the clipboard, NOT restore, and NOT fire the
        // keystroke (it would be swallowed anyway).
        let mut clipboard = FakeClipboard { text: Some("previous-value".to_string()) };
        let mut keystroke_fired = false;

        let outcome = paste_via_clipboard(&mut clipboard, "dictated-text", true, || {
            keystroke_fired = true;
            Ok(())
        })
        .unwrap();

        assert!(!keystroke_fired, "the ⌘V keystroke must never fire under secure input");
        assert_eq!(clipboard.text.as_deref(), Some("dictated-text"), "transcript stays on the clipboard");
        assert!(matches!(outcome, PasteOutcome::SecureInput));
    }

    #[test]
    fn non_secure_input_pastes_and_reports_pasted() {
        let mut clipboard = FakeClipboard { text: Some("previous-value".to_string()) };
        let mut keystroke_fired = false;

        let outcome = paste_via_clipboard(&mut clipboard, "dictated-text", false, || {
            keystroke_fired = true;
            Ok(())
        })
        .unwrap();

        assert!(keystroke_fired, "the ⌘V keystroke fires on the normal path");
        assert_eq!(clipboard.text.as_deref(), Some("previous-value"), "previous clipboard is restored");
        assert!(matches!(outcome, PasteOutcome::Pasted));
    }

    #[test]
    fn clipboard_roundtrip_preserves_previous_text() {
        // Touches the real macOS pasteboard. Skips (returns early) where no
        // pasteboard is available (headless CI); restores whatever was there.
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(_) => return,
        };
        let original = clipboard.get_text().ok();

        clipboard.set_text("verba-paste-test").unwrap();
        assert_eq!(clipboard.get_text().unwrap(), "verba-paste-test");

        match original {
            Some(prev) => clipboard.set_text(prev).unwrap(),
            None => {
                let _ = clipboard.clear();
            }
        }
    }
}
