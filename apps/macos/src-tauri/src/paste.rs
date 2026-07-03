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
#[tauri::command]
pub async fn paste_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || paste_text_blocking(&text))
        .await
        .map_err(|e| format!("Paste failed: {e}"))?
}

fn paste_text_blocking(text: &str) -> Result<(), String> {
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Paste failed: clipboard unavailable: {e}"))?;
    let previous = clipboard.get_text().ok();

    clipboard
        .set_text(text)
        .map_err(|e| format!("Paste failed: could not write clipboard: {e}"))?;
    thread::sleep(PASTEBOARD_PROPAGATION_DELAY);

    synthesize_cmd_v()?;

    thread::sleep(CLIPBOARD_RESTORE_DELAY);
    if let Some(prev) = previous {
        if let Err(e) = clipboard.set_text(prev) {
            // The paste itself succeeded; a failed restore is log-only.
            eprintln!("[Verba] Could not restore previous clipboard content: {e}");
        }
    }
    Ok(())
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
