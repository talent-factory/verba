//! JSON-file key/value store + audio file reader (M2).
//! Backs the frontend `TauriKeyValueStore` and the core's `AudioBytesReader`.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("store.json"))
}

fn read_map(app: &AppHandle) -> Result<HashMap<String, Value>, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).or_else(|e| {
        eprintln!("[Verba] store.json is corrupt, resetting to empty ({e}): {path:?}");
        Ok(HashMap::new())
    })
}

#[tauri::command]
pub fn kv_load(app: AppHandle) -> Result<HashMap<String, Value>, String> {
    read_map(&app)
}

#[tauri::command]
pub fn kv_set(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let mut map = read_map(&app)?;
    map.insert(key, value);
    let path = store_path(&app)?;
    let json = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Reads raw bytes of a recorded WAV so the core's Deepgram provider can upload
/// them. Returned as a byte array over IPC.
#[tauri::command]
pub fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}
