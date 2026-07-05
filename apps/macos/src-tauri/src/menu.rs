//! The tray settings menu. On any change it writes the config file, rebuilds
//! the menu (so checkmarks reflect the file), and emits `config:changed` so the
//! frontend re-applies the settings live. No menu-item handles are stored —
//! the menu is cheap to rebuild.

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

use crate::config::{config_path, read_config_value, read_template_choices, write_config_key};

// (label, value, enabled)
const TRANSCRIPTION_LANGS: &[(&str, &str, bool)] = &[
    ("Auto / Mehrsprachig", "multi", true),
    ("Deutsch", "de", true),
    ("English", "en", true),
    ("Français", "fr", true),
    ("Español", "es", true),
    ("Italiano", "it", true),
    ("Nederlands", "nl", true),
    ("Português", "pt", true),
];
const CLEANUP_LANGS: &[(&str, &str, bool)] = &[
    ("Automatisch", "auto", true),
    ("Deutsch", "de", true),
    ("English", "en", true),
    ("Français", "fr", true),
    ("Español", "es", true),
    ("Italiano", "it", true),
    ("Nederlands", "nl", true),
    ("Português", "pt", true),
];
// The `local` entry is intentionally disabled (`false`): local whisper.cpp
// transcription is not yet wired on macOS, so the option is shown for
// discoverability but cannot be selected. `wiring.ts` always builds the
// Deepgram provider regardless of this setting.
const PROVIDERS: &[(&str, &str, bool)] = &[
    ("Deepgram", "deepgram", true),
    ("Lokal – whisper.cpp", "local", false),
];

fn check_items(
    app: &AppHandle,
    key: &str,
    default: &str,
    opts: &[(&str, &str, bool)],
) -> Result<Vec<CheckMenuItem<Wry>>, tauri::Error> {
    let current = read_config_value(key, default);
    opts.iter()
        .map(|(label, value, enabled)| {
            CheckMenuItem::with_id(
                app,
                format!("set:{key}:{value}"),
                *label,
                *enabled,
                *value == current,
                None::<&str>,
            )
        })
        .collect()
}

fn submenu(app: &AppHandle, title: &str, items: &[CheckMenuItem<Wry>]) -> Result<Submenu<Wry>, tauri::Error> {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, title, true, &refs)
}

/// Builds the full tray menu, with checkmarks reflecting the current config.
pub fn build_settings_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let t = check_items(app, "transcription.language", "multi", TRANSCRIPTION_LANGS)?;
    let c = check_items(app, "language", "auto", CLEANUP_LANGS)?;
    let p = check_items(app, "transcription.provider", "deepgram", PROVIDERS)?;

    let transcription = submenu(app, "Transkriptionssprache", &t)?;
    let cleanup = submenu(app, "Cleanup-Sprache (Claude)", &c)?;
    let provider = submenu(app, "Provider", &p)?;

    let template_choices = read_template_choices();
    let default_active = template_choices
        .first()
        .map(|(_, name)| name.clone())
        .unwrap_or_default();
    let active = read_config_value("activeTemplate", &default_active);
    let template_items: Vec<CheckMenuItem<Wry>> = template_choices
        .iter()
        .map(|(label, name)| {
            CheckMenuItem::with_id(
                app,
                format!("settmpl:{name}"),
                label.as_str(),
                true,
                *name == active,
                None::<&str>,
            )
        })
        .collect::<Result<_, _>>()?;
    let template = submenu(app, "Vorlage", &template_items)?;

    let sep = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, "open-config", "Konfiguration öffnen…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload-config", "Konfiguration neu laden", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Verba", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[&transcription, &cleanup, &provider, &template, &sep, &open, &reload, &quit],
    )
}

/// A parsed tray-menu action. Menu IDs are app-generated (see
/// [`build_settings_menu`]), never user/WebView input.
#[derive(Debug, PartialEq, Eq)]
enum MenuAction {
    Quit,
    OpenConfig,
    ReloadConfig,
    SetActiveTemplate(String),
    SetConfigKey { key: String, value: String },
}

/// Parses a tray menu item id into a [`MenuAction`].
///
/// `set:<dotted.key>:<value>` is split with `rsplit_once(':')` so dotted keys
/// survive (`set:transcription.language:de` → key `transcription.language`,
/// value `de`). `settmpl:<name>` takes the whole remainder as the template name,
/// so a template name containing `:` is preserved. Returns `None` for unknown
/// ids or a malformed `set:` id with no value separator.
fn parse_menu_id(id: &str) -> Option<MenuAction> {
    match id {
        "quit" => Some(MenuAction::Quit),
        "open-config" => Some(MenuAction::OpenConfig),
        "reload-config" => Some(MenuAction::ReloadConfig),
        _ => {
            if let Some(name) = id.strip_prefix("settmpl:") {
                Some(MenuAction::SetActiveTemplate(name.to_string()))
            } else if let Some(rest) = id.strip_prefix("set:") {
                let (key, value) = rest.rsplit_once(':')?;
                Some(MenuAction::SetConfigKey {
                    key: key.to_string(),
                    value: value.to_string(),
                })
            } else {
                None
            }
        }
    }
}

/// Handles a tray menu click.
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match parse_menu_id(id) {
        Some(MenuAction::Quit) => app.exit(0),
        Some(MenuAction::OpenConfig) => open_config(),
        Some(MenuAction::ReloadConfig) => rebuild_and_reload(app),
        Some(MenuAction::SetActiveTemplate(name)) => {
            write_or_notify(app, "activeTemplate", serde_json::Value::String(name));
        }
        Some(MenuAction::SetConfigKey { key, value }) => {
            write_or_notify(app, &key, serde_json::Value::String(value));
        }
        None => {}
    }
}

/// Persists a config key, then rebuilds the menu and reloads the frontend. On a
/// write failure the value is NOT persisted, so the rebuilt menu correctly keeps
/// the old checkmark; the failure is additionally surfaced to the user. A bare
/// `eprintln!` is invisible in a bundled `.app`, so we emit `config:error` for
/// `main.ts` to turn into a notification — otherwise a failed save looks like the
/// setting silently snapping back for no reason.
fn write_or_notify(app: &AppHandle, key: &str, value: serde_json::Value) {
    if let Err(e) = write_config_key(key, value) {
        eprintln!("[Verba] write_config_key failed for {key}: {e}");
        let _ = app.emit("config:error", format!("Could not save setting “{key}”: {e}"));
    }
    rebuild_and_reload(app);
}

/// Rebuilds the tray menu (updated checkmarks) and tells the frontend to reload.
fn rebuild_and_reload(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("verba-tray") {
        if let Ok(menu) = build_settings_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    let _ = app.emit("config:changed", ());
}

/// Ensures the config file exists (creating an empty one) and opens it.
fn open_config() {
    let Some(path) = config_path() else { return };
    if !path.exists() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, "{}\n");
    }
    let _ = std::process::Command::new("open").arg(&path).status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dotted_set_keys_by_splitting_on_the_last_colon() {
        assert_eq!(
            parse_menu_id("set:transcription.language:de"),
            Some(MenuAction::SetConfigKey {
                key: "transcription.language".to_string(),
                value: "de".to_string(),
            })
        );
    }

    #[test]
    fn parses_flat_set_keys() {
        assert_eq!(
            parse_menu_id("set:language:de"),
            Some(MenuAction::SetConfigKey {
                key: "language".to_string(),
                value: "de".to_string(),
            })
        );
    }

    #[test]
    fn parses_template_ids_and_preserves_colons_in_the_name() {
        assert_eq!(
            parse_menu_id("settmpl:E-Mail"),
            Some(MenuAction::SetActiveTemplate("E-Mail".to_string()))
        );
        assert_eq!(
            parse_menu_id("settmpl:Weird:Name"),
            Some(MenuAction::SetActiveTemplate("Weird:Name".to_string()))
        );
    }

    #[test]
    fn parses_the_fixed_command_ids() {
        assert_eq!(parse_menu_id("quit"), Some(MenuAction::Quit));
        assert_eq!(parse_menu_id("open-config"), Some(MenuAction::OpenConfig));
        assert_eq!(parse_menu_id("reload-config"), Some(MenuAction::ReloadConfig));
    }

    #[test]
    fn returns_none_for_unknown_or_malformed_ids() {
        assert_eq!(parse_menu_id("bogus"), None);
        // `set:` with no value separator is malformed and ignored.
        assert_eq!(parse_menu_id("set:novalue"), None);
    }
}
