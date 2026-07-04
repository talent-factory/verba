//! Menu-bar (tray) state feedback: swaps the tray icon and sets tooltip/title
//! to reflect the current dictation state. The tooltip/title strings come from
//! the frontend (single source: `statePresentation.ts`); the icon asset is
//! selected here by state key.

use tauri::image::Image;
use tauri::AppHandle;

const IDLE_ICON: &[u8] = include_bytes!("../icons/state/idle.png");
const RECORDING_ICON: &[u8] = include_bytes!("../icons/state/recording.png");
const TRANSCRIBING_ICON: &[u8] = include_bytes!("../icons/state/transcribing.png");
const PROCESSING_ICON: &[u8] = include_bytes!("../icons/state/processing.png");

fn icon_bytes(state: &str) -> &'static [u8] {
    match state {
        "recording" => RECORDING_ICON,
        "transcribing" => TRANSCRIBING_ICON,
        "processing" => PROCESSING_ICON,
        _ => IDLE_ICON,
    }
}

/// Updates the tray icon, tooltip, and (macOS) title for `state`. Best-effort:
/// if the tray is not yet available it returns Ok without error.
#[tauri::command]
pub fn set_tray_state(
    app: AppHandle,
    state: String,
    tooltip: String,
    title: String,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("verba-tray") else {
        return Ok(());
    };
    let image = Image::from_bytes(icon_bytes(&state)).map_err(|e| e.to_string())?;
    tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    tray.set_icon_as_template(true).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    tray.set_title(Some(&title)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = &title;
    Ok(())
}
