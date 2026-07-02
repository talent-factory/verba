use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// Builds and runs the Verba menu-bar app.
///
/// M1 scope: a tray (menu-bar) app with a Quit item and the global-shortcut +
/// notification plugins registered. The hotkey handler is registered from the
/// frontend (`src/main.ts`) via the global-shortcut plugin. Audio capture,
/// keychain, and paste commands arrive in M2/M3.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Menu-bar-only app: no Dock icon (macOS "accessory" activation).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let quit = MenuItem::with_id(app, "quit", "Quit Verba", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("a default window icon is configured in tauri.conf.json");

            let _tray = TrayIconBuilder::with_id("verba-tray")
                .icon(icon)
                .menu(&menu)
                .tooltip("Verba")
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Verba application");
}
