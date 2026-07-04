//! Reads the user's JSON config file (`~/.config/verba/config.json`, honoring
//! `$XDG_CONFIG_HOME`) for the frontend. Parsing and validation happen on the
//! frontend, so this stays a dumb reader that never fails.

use std::path::PathBuf;

/// The bundled default templates — the same file the frontend imports.
pub const DEFAULT_TEMPLATES_JSON: &str = include_str!("../../src/config/defaultTemplates.json");

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

/// A JSON value counts as a valid template entry only if it is an object with
/// a non-empty string `name` and a string `prompt` — mirrors the TS
/// `isTemplateArray` predicate in `apps/macos/src/config/verbaConfig.ts`.
fn is_valid_template_entry(t: &serde_json::Value) -> bool {
    t.is_object()
        && t.get("name")
            .and_then(|n| n.as_str())
            .is_some_and(|s| !s.is_empty())
        && t.get("prompt").is_some_and(|p| p.is_string())
}

/// Returns `(label, name)` pairs for the tray "Vorlage" submenu. Uses the
/// config's `templates` array only if it is a non-empty array and *every*
/// entry is valid (see [`is_valid_template_entry`]) — all-or-nothing, to stay
/// in lockstep with the TS `isTemplateArray` reader. Otherwise falls back to
/// parsing `default_json`. `label` prefixes the emoji `icon` when present.
pub fn template_choices_from_value(
    cfg: &serde_json::Value,
    default_json: &str,
) -> Vec<(String, String)> {
    let arr: Vec<serde_json::Value> = match cfg.get("templates").and_then(|v| v.as_array()) {
        Some(a) if !a.is_empty() && a.iter().all(is_valid_template_entry) => a.clone(),
        _ => serde_json::from_str(default_json).unwrap_or_default(),
    };
    arr.iter()
        .filter_map(|t| {
            let name = t.get("name").and_then(|n| n.as_str())?;
            let label = match t.get("icon").and_then(|i| i.as_str()) {
                Some(icon) if !icon.is_empty() => format!("{icon} {name}"),
                _ => name.to_string(),
            };
            Some((label, name.to_string()))
        })
        .collect()
}

/// Reads the config file (or `{}`) and returns the tray template choices.
pub fn read_template_choices() -> Vec<(String, String)> {
    let cfg: serde_json::Value = config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    template_choices_from_value(&cfg, DEFAULT_TEMPLATES_JSON)
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

    #[test]
    fn template_choices_uses_config_templates_when_present() {
        let cfg = serde_json::json!({
            "templates": [ { "name": "Custom", "prompt": "x", "icon": "🎯" } ]
        });
        let choices = template_choices_from_value(&cfg, DEFAULT_TEMPLATES_JSON);
        assert_eq!(choices, vec![("🎯 Custom".to_string(), "Custom".to_string())]);
    }

    #[test]
    fn template_choices_falls_back_to_bundled_defaults() {
        let choices = template_choices_from_value(&serde_json::json!({}), DEFAULT_TEMPLATES_JSON);
        assert_eq!(choices.len(), 9);
        assert_eq!(choices[0].1, "Freitext");
        assert_eq!(choices[0].0, "✏️ Freitext");
    }

    #[test]
    fn template_choices_falls_back_when_any_entry_is_invalid() {
        // non-array templates → defaults
        let bad = serde_json::json!({ "templates": "nope" });
        assert_eq!(template_choices_from_value(&bad, DEFAULT_TEMPLATES_JSON).len(), 9);
        // a mixed array where one entry lacks a valid name/prompt is entirely
        // invalid (all-or-nothing) → falls back to the 9 bundled defaults,
        // matching the TS `isTemplateArray` semantics.
        let mixed = serde_json::json!({
            "templates": [ { "prompt": "no name" }, { "name": "Ok", "prompt": "y" } ]
        });
        let choices = template_choices_from_value(&mixed, DEFAULT_TEMPLATES_JSON);
        assert_eq!(choices.len(), 9);
        assert_eq!(choices[0].1, "Freitext");
    }

    #[test]
    fn template_choices_uses_multi_entry_config_templates_verbatim() {
        let cfg = serde_json::json!({
            "templates": [
                { "name": "Custom", "prompt": "x", "icon": "🎯" },
                { "name": "Other", "prompt": "y" },
            ]
        });
        let choices = template_choices_from_value(&cfg, DEFAULT_TEMPLATES_JSON);
        assert_eq!(
            choices,
            vec![
                ("🎯 Custom".to_string(), "Custom".to_string()),
                ("Other".to_string(), "Other".to_string()),
            ]
        );
    }
}
