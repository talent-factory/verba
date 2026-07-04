//! The tray settings menu. On any change it writes the config file, rebuilds
//! the menu (so checkmarks reflect the file), and emits `config:changed` so the
//! frontend re-applies the settings live. No menu-item handles are stored —
//! the menu is cheap to rebuild.

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

use crate::config::{config_path, read_config_value, write_config_key};

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

    let sep = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, "open-config", "Konfiguration öffnen…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload-config", "Konfiguration neu laden", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Verba", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[&transcription, &cleanup, &provider, &sep, &open, &reload, &quit],
    )
}

/// Handles a tray menu click.
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "quit" => {
            app.exit(0);
        }
        "open-config" => open_config(),
        "reload-config" => rebuild_and_reload(app),
        other => {
            if let Some(rest) = other.strip_prefix("set:") {
                // rsplit at the LAST ':' so dotted keys survive (e.g. transcription.language:de)
                if let Some((key, value)) = rest.rsplit_once(':') {
                    if let Err(e) = write_config_key(key, serde_json::Value::String(value.to_string())) {
                        eprintln!("[Verba] write_config_key failed: {e}");
                    }
                    rebuild_and_reload(app);
                }
            }
        }
    }
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
