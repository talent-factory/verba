//! The floating HUD window. Rust owns show/hide/position so the window is
//! never focused — critical: a focused HUD would steal focus and the paste's
//! synthetic ⌘V would land in Verba instead of the user's frontmost app.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

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
    state: String,
    label: String,
    icon: String,
    accent: String,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("hud") else {
        return Ok(());
    };
    if state == "idle" {
        let _ = win.hide();
        return Ok(());
    }
    let _ = app.emit_to("hud", "hud:state", HudPayload { label, icon, accent });
    position_bottom_center(&win);
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    let _ = win.show(); // deliberately NOT set_focus — must not steal focus
    Ok(())
}

fn position_bottom_center(win: &WebviewWindow) {
    let Ok(Some(monitor)) = win.primary_monitor() else {
        return;
    };
    let Ok(size) = win.outer_size() else {
        return;
    };
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let margin: i32 = 80;
    let x = m_pos.x + (m_size.width as i32 - size.width as i32) / 2;
    let y = m_pos.y + m_size.height as i32 - size.height as i32 - margin;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}
