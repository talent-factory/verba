//! Menu-bar (tray) state feedback: swaps the tray icon and sets tooltip/title
//! to reflect the current dictation state. The tooltip/title strings come from
//! the frontend (single source: `statePresentation.ts`); the icon asset is
//! selected here by state key.

use serde::Deserialize;
use tauri::image::Image;
use tauri::AppHandle;

const IDLE_ICON: &[u8] = include_bytes!("../icons/state/idle.png");
const RECORDING_ICON: &[u8] = include_bytes!("../icons/state/recording.png");
const TRANSCRIBING_ICON: &[u8] = include_bytes!("../icons/state/transcribing.png");
const PROCESSING_ICON: &[u8] = include_bytes!("../icons/state/processing.png");

/// The discrete dictation state, deserialized from the frontend's
/// `DictationState` string union (see
/// `apps/macos/src/visualization/statePresentation.ts`). Deserialization
/// rejects any value outside these four, so a typo surfaces as an IPC error
/// (swallowed best-effort in `visualization.ts`) instead of silently rendering
/// as idle — the whole point of a closed enum over a bare `String`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DictationState {
    Idle,
    Recording,
    Transcribing,
    Processing,
}

fn icon_bytes(state: DictationState) -> &'static [u8] {
    match state {
        DictationState::Recording => RECORDING_ICON,
        DictationState::Transcribing => TRANSCRIBING_ICON,
        DictationState::Processing => PROCESSING_ICON,
        DictationState::Idle => IDLE_ICON,
    }
}

/// Updates the tray icon, tooltip, and (macOS) title for `state`. Best-effort:
/// if the tray is not yet available it returns Ok without error.
#[tauri::command]
pub fn set_tray_state(
    app: AppHandle,
    state: DictationState,
    tooltip: String,
    title: String,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("verba-tray") else {
        return Ok(());
    };
    let image = Image::from_bytes(icon_bytes(state)).map_err(|e| e.to_string())?;
    tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    tray.set_icon_as_template(true).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    tray.set_title(Some(&title)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = &title;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_bytes_maps_each_state_to_its_asset() {
        assert_eq!(icon_bytes(DictationState::Idle), IDLE_ICON);
        assert_eq!(icon_bytes(DictationState::Recording), RECORDING_ICON);
        assert_eq!(icon_bytes(DictationState::Transcribing), TRANSCRIBING_ICON);
        assert_eq!(icon_bytes(DictationState::Processing), PROCESSING_ICON);
    }

    #[test]
    fn dictation_state_deserializes_the_frontend_lowercase_union() {
        assert_eq!(
            serde_json::from_str::<DictationState>("\"idle\"").unwrap(),
            DictationState::Idle
        );
        assert_eq!(
            serde_json::from_str::<DictationState>("\"processing\"").unwrap(),
            DictationState::Processing
        );
        // An unknown state is rejected rather than silently coerced to idle.
        assert!(serde_json::from_str::<DictationState>("\"bogus\"").is_err());
    }
}
