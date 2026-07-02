//! Accessibility permission check + System Settings deep-link (M3, onboarding
//! UI slice). The real paste mechanism (`paste_text`) is a separate,
//! higher-risk follow-up slice — see docs/development/phase-1-macos-app.md.

/// URL that opens System Settings directly on the Accessibility pane.
const ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

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
    std::process::Command::new("open")
        .arg(ACCESSIBILITY_SETTINGS_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
