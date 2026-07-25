mod activation;
mod audio;
mod config;
mod deliver;
mod detect;
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

/// Disables macOS **App Nap** for the whole process lifetime.
///
/// Verba is an Accessory (menu-bar, no-Dock) app whose main WebView window stays
/// hidden. Once recording stops, the app is neither visible nor playing audio,
/// so macOS naps the process — throttling the hidden WebView's JS event loop and
/// timer/IPC delivery. The dictation flow (transcribe → cleanup → paste) runs in
/// that WebView, so a napped process stalls at "Transcribing…"/"Processing…":
/// the native Rust command returns, but its IPC response isn't delivered to JS
/// until some event (e.g. a hotkey press) wakes the run loop — which is why the
/// flow appears to need a second hotkey press to finish.
///
/// The exempting activity option is `UserInitiatedAllowingIdleSystemSleep`: it
/// tells the system this is user-initiated work, so App Nap and timer throttling
/// are disabled, while normal idle *system* sleep is still allowed (the Mac can
/// sleep per the user's Energy Saver settings). `NSActivityBackground`, used
/// before, does NOT prevent App Nap — per Apple it is the discretionary /
/// maintenance priority band that App Nap is explicitly *allowed* to defer; it
/// only disabled sudden/automatic termination, so the stall kept recurring
/// intermittently. The token must stay retained for the app lifetime (dropping
/// it re-enables App Nap), so it is intentionally leaked.
#[cfg(target_os = "macos")]
fn disable_app_nap() {
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    let info = NSProcessInfo::processInfo();
    let reason = NSString::from_str("Verba keeps the hidden dictation WebView responsive");
    let token = info.beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        &reason,
    );
    // Retain for the whole app lifetime — dropping the token re-enables App Nap.
    std::mem::forget(token);
}

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
            deliver::herdr_send,
            env::env_var,
            http::anthropic_fetch,
            hud::set_hud_state,
            hud::set_hud_message,
            paste::has_accessibility_permission,
            paste::open_accessibility_settings,
            paste::paste_text,
            paste::press_enter,
            detect::detect_surface,
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

            // Keep App Nap from throttling the hidden WebView (see fn docs) — the
            // dictation flow otherwise stalls at "Transcribing…"/"Processing…".
            #[cfg(target_os = "macos")]
            disable_app_nap();

            // Push-to-Talk-Event-Tap (rechts-Cmd → insert, rechts-Option → submit)
            // auf eigenem CFRunLoop-Thread; UAT-verifiziert (Task 8).
            #[cfg(target_os = "macos")]
            activation::start(app.handle().clone());

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
