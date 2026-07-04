//! Reads the user's JSON config file (`~/.config/verba/config.json`, honoring
//! `$XDG_CONFIG_HOME`) for the frontend. Parsing and validation happen on the
//! frontend, so this stays a dumb reader that never fails.

use std::path::PathBuf;

/// `$XDG_CONFIG_HOME/verba/config.json` if that var is set and non-empty, else
/// `$HOME/.config/verba/config.json`. `None` if `HOME` is also unavailable.
fn config_path() -> Option<PathBuf> {
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
}
