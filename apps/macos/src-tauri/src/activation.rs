//! Push-to-Talk-Aktivierung: ein CGEventTap auf `flagsChanged` übersetzt Halten/
//! Loslassen von rechts-Cmd/rechts-Option in ptt:down/ptt:up-Events. Die reine
//! Flag→Event-Abbildung ist unit-getestet; der Tap-Thread ist UAT-verifiziert.

use core_graphics::event::CGEventFlags;

/// Virtuelle Keycodes der rechten Modifier (Carbon Events.h).
const KEY_RIGHT_COMMAND: i64 = 0x36;
const KEY_RIGHT_OPTION: i64 = 0x3D;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Intent {
    Insert,
    Submit,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PttEvent {
    Down(Intent),
    Up,
}

impl Intent {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Intent::Insert => "insert",
            Intent::Submit => "submit",
        }
    }
}

/// Reine Klassifikation eines `flagsChanged`-Events: welcher unserer Modifier
/// änderte sich, und ist er jetzt gedrückt (Down) oder losgelassen (Up)?
/// Fremde Keycodes → `None` (ignorieren).
pub(crate) fn classify_flags_changed(keycode: i64, flags: CGEventFlags) -> Option<PttEvent> {
    match keycode {
        KEY_RIGHT_COMMAND => Some(if flags.contains(CGEventFlags::CGEventFlagCommand) {
            PttEvent::Down(Intent::Insert)
        } else {
            PttEvent::Up
        }),
        KEY_RIGHT_OPTION => Some(if flags.contains(CGEventFlags::CGEventFlagAlternate) {
            PttEvent::Down(Intent::Submit)
        } else {
            PttEvent::Up
        }),
        _ => None,
    }
}

use core_foundation_010::base::TCFType;
use core_foundation_010::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy,
    CGEventType, CallbackResult, EventField,
};
use core_graphics::sys::CGEventTapRef;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Raw event-tap mach port, shared with the tap callback so it can re-enable
/// the tap from inside itself on `TapDisabledByTimeout`/`TapDisabledByUserInput`.
/// `CGEventTapRef` is a raw pointer (not `Send`), and `CGEventTap::new` requires
/// its callback to be `Send` — so the handle is wrapped in a newtype with a
/// manual `Send` impl. Safe because the tap only ever runs on this function's
/// single dedicated run-loop thread; it is never touched concurrently.
struct TapHandle(CGEventTapRef);
unsafe impl Send for TapHandle {}

// `CGEventTapEnable` is not exposed as a public function by the `core-graphics`
// crate (it's a private FFI declaration internal to `event.rs`), so it is
// re-declared here to re-enable the tap from the callback. `CoreGraphics` is
// already linked in transitively via the `core-graphics` crate.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapEnable(tap: CGEventTapRef, enable: bool);
}

/// Startet den Push-to-Talk-Event-Tap auf einem dedizierten Thread. Fehler beim
/// Installieren werden geloggt; die App bleibt über den Toggle-Alias nutzbar.
pub(crate) fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // Der Handler braucht einen eigenen `AppHandle`-Klon, weil `app` unten in
        // den Fehlerzweigen (Tap-/Runloop-Erstellung) noch für `config:error`
        // gebraucht wird, nachdem der (Fn-fähige) Handler seine Kopie moved hat.
        let handler_app = app.clone();
        // Filled in after `CGEventTap::new` returns below — the tap doesn't exist
        // yet while the callback closure is being built (chicken-and-egg), so the
        // handler receives a shared, initially-empty slot and the tap handle is
        // written into it once `CGEventTap::new`/`.mach_port()` are available.
        let tap_handle: Arc<Mutex<Option<TapHandle>>> = Arc::new(Mutex::new(None));
        let tap_handle_for_callback = tap_handle.clone();
        let handler =
            move |_proxy: CGEventTapProxy, etype: CGEventType, event: &CGEvent| -> CallbackResult {
                if matches!(
                    etype,
                    CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
                ) {
                    // macOS auto-disabled the tap (slow handler, or the user toggled
                    // the Accessibility/Input-Monitoring grant at runtime) — re-arm it
                    // so PTT doesn't go silently dead until app restart.
                    if let Some(handle) = tap_handle_for_callback.lock().unwrap().as_ref() {
                        unsafe { CGEventTapEnable(handle.0, true) };
                    }
                    return CallbackResult::Keep;
                }
                let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                if let Some(ev) = classify_flags_changed(keycode, event.get_flags()) {
                    match ev {
                        PttEvent::Down(intent) => {
                            let _ = handler_app.emit("ptt:down", intent.as_str());
                        }
                        PttEvent::Up => {
                            let _ = handler_app.emit("ptt:up", ());
                        }
                    }
                }
                CallbackResult::Keep // Event unverändert weiterreichen (passiver Tap).
            };

        let tap = match CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::FlagsChanged],
            handler,
        ) {
            Ok(t) => t,
            Err(e) => {
                eprintln!(
                    "[Verba] Konnte Push-to-Talk-Event-Tap nicht erstellen ({e:?}); nutze Toggle-Alias."
                );
                let _ = app.emit(
                    "config:error",
                    format!(
                        "Push-to-Talk konnte nicht aktiviert werden ({e:?}) — nutze Ctrl+Alt+D."
                    ),
                );
                return;
            }
        };

        let loop_source = match tap.mach_port().create_runloop_source(0) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Verba] Konnte Runloop-Source für Event-Tap nicht erstellen ({e:?}).");
                let _ = app.emit(
                    "config:error",
                    format!(
                        "Push-to-Talk konnte nicht aktiviert werden ({e:?}) — nutze Ctrl+Alt+D."
                    ),
                );
                return;
            }
        };
        // Make the tap reachable from inside the callback (see `tap_handle` above)
        // so it can re-enable itself on TapDisabledByTimeout/TapDisabledByUserInput.
        *tap_handle.lock().unwrap() = Some(TapHandle(tap.mach_port().as_concrete_TypeRef()));
        unsafe {
            CFRunLoop::get_current().add_source(&loop_source, kCFRunLoopCommonModes);
        }
        tap.enable();
        CFRunLoop::run_current();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn right_command_press_is_insert_down() {
        let e = classify_flags_changed(0x36, CGEventFlags::CGEventFlagCommand);
        assert_eq!(e, Some(PttEvent::Down(Intent::Insert)));
    }

    #[test]
    fn right_command_release_is_up() {
        let e = classify_flags_changed(0x36, CGEventFlags::empty());
        assert_eq!(e, Some(PttEvent::Up));
    }

    #[test]
    fn right_option_press_is_submit_down() {
        let e = classify_flags_changed(0x3D, CGEventFlags::CGEventFlagAlternate);
        assert_eq!(e, Some(PttEvent::Down(Intent::Submit)));
    }

    #[test]
    fn unrelated_keycode_is_ignored() {
        assert_eq!(classify_flags_changed(0x00, CGEventFlags::CGEventFlagShift), None);
    }
}
