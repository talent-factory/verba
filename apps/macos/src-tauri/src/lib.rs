mod audio;
mod config;
mod env;
mod http;
mod hud;
mod menu;
mod paste;
mod secret;
mod store;
mod transcribe;
mod tray;

use tauri::tray::TrayIconBuilder;

use audio::CaptureState;

/// Builds and runs the Verba menu-bar app.
///
/// Tray (menu-bar) app with the global-shortcut + notification plugins. The
/// hotkey handler is registered from the frontend (`src/main.ts`). M2 adds the
/// capture/secret/store commands; M3 adds Accessibility onboarding and native
/// Deepgram transcription (`@deepgram/sdk` refuses to run in a browser
/// context; see `transcribe.rs`). Paste itself is a separate follow-up.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            audio::start_capture,
            audio::stop_capture,
            config::read_config,
            env::env_var,
            http::anthropic_fetch,
            hud::set_hud_state,
            paste::has_accessibility_permission,
            paste::open_accessibility_settings,
            paste::paste_text,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            store::kv_load,
            store::kv_set,
            transcribe::deepgram_transcribe,
            tray::set_tray_state,
        ])
        .setup(|app| {
            // Menu-bar-only app: no Dock icon (macOS "accessory" activation).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let menu = menu::build_settings_menu(app.handle())?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("a default window icon is configured in tauri.conf.json");

            let _tray = TrayIconBuilder::with_id("verba-tray")
                .icon(icon)
                .menu(&menu)
                .tooltip("Verba")
                .on_menu_event(|app, event| menu::handle_menu_event(app, event.id.as_ref()))
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Verba application");
}
