//! Reads the user's JSON config file (`~/.config/verba/config.json`, honoring
//! `$XDG_CONFIG_HOME`) for the frontend. Parsing and validation happen on the
//! frontend, so this stays a dumb reader that never fails.

use std::path::PathBuf;

/// `$XDG_CONFIG_HOME/verba/config.json` if that var is set and non-empty, else
/// `$HOME/.config/verba/config.json`. `None` if `HOME` is also unavailable.
pub(crate) fn config_path() -> Option<PathBuf> {
    let base = match std::env::var("XDG_CONFIG_HOME") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => PathBuf::from(std::env::var("HOME").ok()?).join(".config"),
    };
    Some(base.join("verba").join("config.json"))
}

/// Returns the raw contents of the config file, or `"{}"` if it is absent or
/// unreadable. Never fails — the frontend parses and applies defaults.
#[tauri::command]
pub fn read_config() -> String {
    config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| "{}".to_string())
}

/// Sets `dotted` (e.g. `"transcription.language"`) to `value` inside `root`,
/// creating intermediate objects and coercing non-object levels to objects.
pub fn set_json_key(root: &mut serde_json::Value, dotted: &str, value: serde_json::Value) {
    if !root.is_object() {
        *root = serde_json::json!({});
    }
    let parts: Vec<&str> = dotted.split('.').collect();
    let mut cur = root;
    for part in &parts[..parts.len() - 1] {
        let obj = cur.as_object_mut().expect("coerced to object above/below");
        let entry = obj
            .entry((*part).to_string())
            .or_insert_with(|| serde_json::json!({}));
        if !entry.is_object() {
            *entry = serde_json::json!({});
        }
        cur = entry;
    }
    if let Some(obj) = cur.as_object_mut() {
        obj.insert(parts[parts.len() - 1].to_string(), value);
    }
}

/// Reads the config file (or `{}`), sets `dotted` to `value`, and writes the
/// result back as pretty JSON (creating `~/.config/verba/` if needed). Comments
/// in the original file are lost (JSON round-trip).
pub fn write_config_key(dotted: &str, value: serde_json::Value) -> Result<(), String> {
    let path = config_path().ok_or_else(|| "no HOME/XDG_CONFIG_HOME".to_string())?;
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    set_json_key(&mut root, dotted, value);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty).map_err(|e| e.to_string())
}

/// Returns the string at `dotted` in the config file, or `default` if the file
/// is absent/malformed or the key is missing/not-a-string.
pub fn read_config_value(dotted: &str, default: &str) -> String {
    let root: serde_json::Value = config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let mut cur = &root;
    for part in dotted.split('.') {
        match cur.get(part) {
            Some(v) => cur = v,
            None => return default.to_string(),
        }
    }
    cur.as_str().unwrap_or(default).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_config_never_panics_and_returns_nonempty() {
        // Regardless of whether a config file exists on the test machine, the
        // command must return a non-empty string and never panic. Parsing and
        // default-handling are covered by the frontend `loadConfig` tests.
        assert!(!read_config().is_empty());
    }

    #[test]
    fn config_path_ends_with_verba_config_json() {
        if let Some(p) = config_path() {
            assert!(p.ends_with("verba/config.json"));
        }
    }

    #[test]
    fn set_json_key_creates_nested_object() {
        let mut v = serde_json::json!({});
        set_json_key(&mut v, "transcription.language", serde_json::json!("de"));
        assert_eq!(v, serde_json::json!({ "transcription": { "language": "de" } }));
    }

    #[test]
    fn set_json_key_overwrites_existing_leaf_and_preserves_siblings() {
        let mut v = serde_json::json!({ "language": "auto", "glossary": ["x"] });
        set_json_key(&mut v, "language", serde_json::json!("de"));
        assert_eq!(v, serde_json::json!({ "language": "de", "glossary": ["x"] }));
    }

    #[test]
    fn set_json_key_coerces_non_object_root() {
        let mut v = serde_json::json!(5);
        set_json_key(&mut v, "a.b", serde_json::json!("x"));
        assert_eq!(v, serde_json::json!({ "a": { "b": "x" } }));
    }
}
