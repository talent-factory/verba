//! The floating HUD window. Rust owns show/hide/position so the window is
//! never focused — critical: a focused HUD would steal focus and the paste's
//! synthetic ⌘V would land in Verba instead of the user's frontmost app.
//!
//! The non-activating guarantee is enforced by `"focus": false` on the `hud`
//! window in `tauri.conf.json` (plus `macOSPrivateApi`); `show()` below merely
//! avoids *re-focusing* it. Don't remove that config flag on the assumption
//! that omitting `set_focus` here is sufficient — it isn't.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::tray::DictationState;

#[derive(Clone, Serialize)]
struct HudPayload {
    label: String,
    icon: String,
    accent: String,
}

/// `idle` hides the HUD; any other state pushes content to the hud webview,
/// positions it bottom-center, and shows it WITHOUT focus. Best-effort.
#[tauri::command]
pub fn set_hud_state(
    app: AppHandle,
    state: DictationState,
    label: String,
    icon: String,
    accent: String,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("hud") else {
        return Ok(());
    };
    if state == DictationState::Idle {
        let _ = win.hide();
        return Ok(());
    }
    if let Err(e) = app.emit_to("hud", "hud:state", HudPayload { label, icon, accent }) {
        // Swallowed (best-effort) but logged: without the payload the pill would
        // show the PREVIOUS state's content until the next transition.
        eprintln!("[Verba] hud:state emit failed: {e}");
    }
    position_bottom_center(&win);
    // Click-through: the pill must never intercept clicks meant for the app
    // underneath it.
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    let _ = win.show(); // deliberately NOT set_focus — must not steal focus
    Ok(())
}

/// Shows the HUD pill with an ad-hoc message, decoupled from the flow's
/// `DictationState`. Used by the controller to mirror actionable notifications
/// (secure-input, no-speech, delivery failure) onto the always-reliable HUD.
/// Reuses the same `hud:state` event + renderer; positions bottom-center and
/// shows WITHOUT focus (same non-activating guarantee as `set_hud_state`).
/// No-op when the `hud` window doesn't exist. Best-effort.
#[tauri::command]
pub fn set_hud_message(
    app: AppHandle,
    label: String,
    icon: String,
    accent: String,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("hud") else {
        return Ok(());
    };
    if let Err(e) = app.emit_to("hud", "hud:state", HudPayload { label, icon, accent }) {
        eprintln!("[Verba] hud:message emit failed: {e}");
    }
    position_bottom_center(&win);
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    let _ = win.show(); // deliberately NOT set_focus — must not steal focus
    Ok(())
}

fn position_bottom_center(win: &WebviewWindow) {
    let monitor = match win.current_monitor() {
        Ok(Some(m)) => m,
        _ => match win.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };
    let Ok(size) = win.outer_size() else {
        return;
    };
    // Use the work area (excludes the Dock and menu bar) so the pill is never
    // hidden behind the Dock. A small margin lifts it just above the Dock.
    let work = monitor.work_area();
    let margin: i32 = 12;
    let x = work.position.x + (work.size.width as i32 - size.width as i32) / 2;
    let y = work.position.y + work.size.height as i32 - size.height as i32 - margin;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}
