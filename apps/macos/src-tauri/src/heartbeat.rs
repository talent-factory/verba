//! Run-loop heartbeat that keeps the hidden WebView responsive during the
//! transcribe → cleanup → deliver phase.
//!
//! Symptom it fixes: the flow gets stuck at "Verarbeite mit Claude …" until the
//! user presses a key. A native command (Deepgram, grepai, the Anthropic fetch)
//! returns, but its IPC *response* isn't delivered to the hidden WebView's JS
//! until the main event loop is woken — a key press does that, which is why a
//! second press "finishes" the flow. `disable_app_nap` (lib.rs) turns off App
//! Nap, but the WKWebView occlusion throttle of a hidden window is a *separate*
//! mechanism it doesn't cover, so the stall can still occur.
//!
//! Fix: while a dictation is mid-flight, a background thread emits a no-op event
//! ~every 200ms. `AppHandle::emit` marshals to the main (tao) event loop from
//! this thread via the event-loop proxy, which WAKES the loop — the same effect
//! a key press has — so pending IPC responses are flushed to the WebView without
//! any user input. The frontend flips the flag (`set_dictation_active`) true when
//! `stopAndTranscribe` starts and false when it ends, so the heartbeat only ticks
//! while it matters (no idle battery cost).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// Interval between heartbeats while a dictation is active. Short enough that a
/// stalled IPC response is delivered near-instantly, long enough to be cheap.
const ACTIVE_TICK: Duration = Duration::from_millis(200);
/// Poll interval while idle — no events emitted, just re-checks the flag.
const IDLE_TICK: Duration = Duration::from_millis(400);

/// Shared "a dictation is mid-flight" flag: toggled by the frontend via
/// `set_dictation_active`, read by the heartbeat thread. Managed as Tauri state.
#[derive(Default)]
pub struct DictationActive(pub Arc<AtomicBool>);

/// Flips the heartbeat on/off. The frontend calls this true at the start of the
/// transcribe/cleanup/deliver flow and false when it ends. Fire-and-forget from
/// JS (no response awaited), so this call itself can never stall.
#[tauri::command]
pub fn set_dictation_active(active: bool, state: tauri::State<'_, DictationActive>) {
    state.0.store(active, Ordering::Relaxed);
}

/// Spawns the heartbeat thread for the app's lifetime. Emits `verba:heartbeat`
/// while `active` is set; otherwise idles. Best-effort — a failed emit is ignored
/// (the next tick retries).
pub fn start(app: AppHandle, active: Arc<AtomicBool>) {
    std::thread::spawn(move || loop {
        if active.load(Ordering::Relaxed) {
            let _ = app.emit("verba:heartbeat", ());
            std::thread::sleep(ACTIVE_TICK);
        } else {
            std::thread::sleep(IDLE_TICK);
        }
    });
}
