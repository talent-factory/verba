# Voice → Agent Push (TF-525) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diktat auf einer macOS-Agent-Oberfläche wird per Push-to-Talk aktiviert und agent-nativ in die fokussierte herdr-Pane zugestellt — optional direkt abgesendet — statt blind per ⌘V gepastet.

**Architecture:** Ein Rust-CGEventTap (`activation.rs`) übersetzt Halten/Loslassen von rechts-Cmd/rechts-Option in `ptt:down{intent}`/`ptt:up`-Events. Der `DictationController` bekommt Push-to-Talk-Handler mit Hold-Threshold und leitet den fertigen Text durch ein reines Routing-Modul (`delivery.ts`): fokussierte Agent-Pane mit `pane_id` → `herdr pane send-text` (+ `send-keys Enter` bei submit), sonst Fallback auf den bestehenden `paste_text`. `detect_surface` liefert dafür zusätzlich die `pane_id`.

**Tech Stack:** TypeScript (strict, Mocha-Tests) im Frontend, Rust (Tauri v2, `core-graphics` 0.25 CGEventTap, `cargo test`) im Backend, `@verba/core` als geteiltes Config-/Surface-Schema.

## Global Constraints

- **Plattform:** nur macOS. Kein Windows/Linux.
- **Stale dist:** Nach jeder Änderung an `packages/core/src/**` **`npm run compile:core`** ausführen, bevor `apps/macos` die Änderung sieht (Hosts importieren `@verba/core` aus `dist/`, nicht `src/`).
- **Config-Keys:** macOS-Config nutzt bare Top-Level-Keys ohne `verba.`-Prefix. Neuer Block: `activation`.
- **Delivery-Identität:** immer über die eindeutige **`pane_id`** (z. B. `"wQ:p2"`), nie über das Agent-Label — es können mehrere gleichnamige Agenten (`claude`) laufen.
- **Commits:** ausschließlich über die `git-workflow:commit`-Skill (Deutsch, Emoji-Conventional, **keine** Co-Authored-By-/Generated-Suffixe). Die Commit-Message pro Task ist unten vorgegeben.
- **Test-Kommandos:** core → `npm run test:core` · macOS-TS → `npm run test:unit` (in `apps/macos`) · Rust → `cargo test` (in `apps/macos/src-tauri`).
- **Submit-Reichweite:** das absendende Enter feuert **nur** auf Agent-Surfaces; sonst verhält sich `submit` wie `insert`.

## File Structure

| Datei | Verantwortung | Aktion |
|---|---|---|
| `packages/core/src/config.ts` | `DetectedSurface.paneId` + `activation`-Schema in `VerbaConfig`/`ResolvedConfig`/`resolveConfig` | Modify |
| `apps/macos/src-tauri/src/detect.rs` | `pane_id` aus Snapshot + `Surface::Agent.pane_id` | Modify |
| `apps/macos/src-tauri/src/paste.rs` | neuer Command `press_enter` (synthetisches Return) | Modify |
| `apps/macos/src-tauri/src/deliver.rs` | neuer Command `herdr_send(pane_id, text, submit)` | Create |
| `apps/macos/src-tauri/src/activation.rs` | CGEventTap → `ptt:down`/`ptt:up`; reine `classify_flags_changed` | Create |
| `apps/macos/src-tauri/src/lib.rs` | Commands registrieren; Event-Tap im `setup` starten | Modify |
| `apps/macos/src/delivery.ts` | reines Routing `deliver(text, intent, ports)` | Create |
| `apps/macos/src/controller.ts` | PTT-Handler + Hold-Threshold; Delivery über `deliver()` | Modify |
| `apps/macos/src/wiring.ts` | `DeliveryPorts` bauen + injizieren | Modify |
| `apps/macos/src/main.ts` | `ptt:down`/`ptt:up` listenen (gated auf `activation.mode`) | Modify |
| `apps/macos/src/config/verbaConfig.ts` | `activation` aus `ResolvedConfig` durchreichen | Modify |

Testdateien: `packages/core/test/unit/config.test.ts` (erweitern), `apps/macos/test/unit/delivery.test.ts` (neu), `apps/macos/test/unit/controller.test.ts` (erweitern), Rust-Tests inline in `#[cfg(test)]`.

---

### Task 1: Core-Schema — `DetectedSurface.paneId` + `activation`-Config

**Files:**
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/test/unit/config.test.ts`

**Interfaces:**
- Produces: `DetectedSurface { class, agent?, status?, paneId? }`; `ResolvedConfig.activation: { mode: 'push-to-talk' | 'toggle'; insertKey: string; submitKey: string; holdThresholdMs: number }`.

- [ ] **Step 1: Failing test — `paneId` + `activation` defaults**

In `packages/core/test/unit/config.test.ts` ergänzen (Mocha/assert-Stil der Datei übernehmen):

```ts
it('resolves activation defaults', () => {
  const cfg = resolveConfig(new ObjectConfigProvider({}));
  assert.equal(cfg.activation.mode, 'push-to-talk');
  assert.equal(cfg.activation.insertKey, 'right-command');
  assert.equal(cfg.activation.submitKey, 'right-option');
  assert.equal(cfg.activation.holdThresholdMs, 200);
});

it('accepts an overridden activation block and falls back per-field', () => {
  const cfg = resolveConfig(new ObjectConfigProvider({
    activation: { mode: 'toggle', holdThresholdMs: 350 },
  }));
  assert.equal(cfg.activation.mode, 'toggle');
  assert.equal(cfg.activation.holdThresholdMs, 350);
  assert.equal(cfg.activation.insertKey, 'right-command'); // per-field default
});

it('rejects an invalid activation.mode back to the default', () => {
  const cfg = resolveConfig(new ObjectConfigProvider({ activation: { mode: 'nonsense' } }));
  assert.equal(cfg.activation.mode, 'push-to-talk');
});
```

`ObjectConfigProvider` ggf. aus dem Host importierbar? Nein — im Core-Test einen minimalen Provider inline verwenden, der bereits in der Datei genutzt wird (dieselbe Hilfsklasse wie die vorhandenen `resolveConfig`-Tests; falls die Datei ihren eigenen Fake-Provider hat, den nehmen).

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:core`
Expected: FAIL (`cfg.activation` is undefined).

- [ ] **Step 3: Implement schema**

In `packages/core/src/config.ts`:

Typ + Defaults ergänzen (nach `SurfaceClass`):

```ts
/** Activation model for the macOS host (push-to-talk vs. legacy toggle). */
export type ActivationMode = 'push-to-talk' | 'toggle';

export interface ActivationConfig {
	mode: ActivationMode;
	/** Key held for insert-only dictation. */
	insertKey: string;
	/** Key held for insert-and-submit dictation. */
	submitKey: string;
	/** Minimum hold (ms) before a press starts recording; shorter presses are ignored. */
	holdThresholdMs: number;
}

const DEFAULT_ACTIVATION: ActivationConfig = {
	mode: 'push-to-talk',
	insertKey: 'right-command',
	submitKey: 'right-option',
	holdThresholdMs: 200,
};
```

`DetectedSurface` um `paneId` erweitern:

```ts
export interface DetectedSurface {
	class: SurfaceClass;
	agent?: string;
	status?: string;
	/** herdr pane id of the focused agent (delivery target); absent unless class === 'agent' via herdr. */
	paneId?: string;
}
```

`VerbaConfig` + `ResolvedConfig` um `activation` erweitern:

```ts
// in VerbaConfig:
	activation?: {
		mode?: string;
		insertKey?: string;
		submitKey?: string;
		holdThresholdMs?: number;
	};
// in ResolvedConfig:
	activation: ActivationConfig;
```

Resolver-Helfer + Einbau in `resolveConfig` (vor dem `return`):

```ts
function resolveActivation(provider: ConfigProvider): ActivationConfig {
	const rawMode = provider.get<unknown>('activation.mode', DEFAULT_ACTIVATION.mode);
	const rawThreshold = provider.get<unknown>('activation.holdThresholdMs', DEFAULT_ACTIVATION.holdThresholdMs);
	return {
		mode: rawMode === 'toggle' ? 'toggle' : 'push-to-talk',
		insertKey: nonEmptyString(provider.get<unknown>('activation.insertKey', DEFAULT_ACTIVATION.insertKey))
			? (provider.get<string>('activation.insertKey', DEFAULT_ACTIVATION.insertKey)).trim()
			: DEFAULT_ACTIVATION.insertKey,
		submitKey: nonEmptyString(provider.get<unknown>('activation.submitKey', DEFAULT_ACTIVATION.submitKey))
			? (provider.get<string>('activation.submitKey', DEFAULT_ACTIVATION.submitKey)).trim()
			: DEFAULT_ACTIVATION.submitKey,
		holdThresholdMs: typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) && rawThreshold >= 0
			? rawThreshold
			: DEFAULT_ACTIVATION.holdThresholdMs,
	};
}
```

Und im `return {...}` von `resolveConfig`: `activation: resolveActivation(provider),`.

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:core`
Expected: PASS.

- [ ] **Step 5: Compile core so hosts see the new types**

Run: `npm run compile:core`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

Message (via `git-workflow:commit`): `✨ feat(core): DetectedSurface.paneId + activation-Config-Schema`

---

### Task 2: `detect.rs` — `pane_id` des fokussierten Agenten

**Files:**
- Modify: `apps/macos/src-tauri/src/detect.rs`

**Interfaces:**
- Produces: `Surface::Agent { agent, status, pane_id }`; serialisiert als `{ "class": "agent", "agent": "...", "status": "...", "paneId": "wQ:p2" }`.

Snapshot-Referenz (verifiziert per `herdr api snapshot`): der fokussierte Agent hat `"focused": true`, `"agent"`, `"agent_status"`, und **`"pane_id": "wQ:p2"`**.

- [ ] **Step 1: Failing test — pane_id wird geparst**

In `detect.rs` `#[cfg(test)]` ergänzen:

```rust
#[test]
fn parses_pane_id_of_focused_agent() {
    let json = r#"{"result":{"snapshot":{"agents":[
        {"agent":"claude","focused":true,"agent_status":"working","pane_id":"wQ:p2"}
    ]}}}"#;
    let a = focused_herdr_agent_from_json(json).expect("a focused agent");
    assert_eq!(a.pane_id.as_deref(), Some("wQ:p2"));
}

#[test]
fn agent_surface_carries_pane_id() {
    let herdr = Some(HerdrAgent { agent: "claude".into(), status: "working".into(), pane_id: Some("wQ:p2".into()) });
    let s = classify(front("com.apple.Terminal"), herdr, None,
        &["claude".into()], &["com.apple.Terminal".into()], &[]);
    assert_eq!(s, Surface::Agent { agent: "claude".into(), status: Some("working".into()), pane_id: Some("wQ:p2".into()) });
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test` (in `apps/macos/src-tauri`)
Expected: FAIL (no field `pane_id`).

- [ ] **Step 3: Implement pane_id**

`HerdrAgent`-Struct erweitern:

```rust
pub(crate) struct HerdrAgent {
    pub agent: String,
    pub status: String,
    pub pane_id: Option<String>,
}
```

In `focused_herdr_agent_from_json`, im `focused`-Zweig `pane_id` mit auslesen:

```rust
let pane_id = a.get("pane_id").and_then(|p| p.as_str()).map(|s| s.to_string());
return Some(HerdrAgent { agent, status, pane_id });
```

`Surface::Agent` um `pane_id` erweitern (mit `paneId`-Wire-Name):

```rust
Agent {
    agent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(rename = "paneId", skip_serializing_if = "Option::is_none")]
    pane_id: Option<String>,
},
```

In `classify`, den herdr-Zweig anpassen und den Titel-Marker-Zweig (kein pane_id) ergänzen:

```rust
if let Some(h) = herdr {
    return Surface::Agent { agent: h.agent, status: Some(h.status), pane_id: h.pane_id };
}
if let Some(t) = title {
    let lc = t.to_lowercase();
    if let Some(m) = markers.iter().find(|m| lc.contains(&m.to_lowercase())) {
        return Surface::Agent { agent: m.clone(), status: None, pane_id: None };
    }
}
```

Bestehende Tests, die `Surface::Agent { agent, status }` ohne `pane_id` konstruieren, um `pane_id: None` bzw. den erwarteten Wert ergänzen (Compiler zeigt die Stellen).

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test`
Expected: PASS (alle `detect`-Tests).

- [ ] **Step 5: Commit**

Message: `✨ feat(macos): detect_surface liefert pane_id des fokussierten Agenten`

---

### Task 3: Rust-Delivery-Commands — `press_enter` + `herdr_send`

**Files:**
- Modify: `apps/macos/src-tauri/src/paste.rs` (neuer Command `press_enter`)
- Create: `apps/macos/src-tauri/src/deliver.rs` (`herdr_send`)
- Modify: `apps/macos/src-tauri/src/lib.rs` (Module + Handler)

**Interfaces:**
- Produces (IPC): `press_enter() -> Result<(), String>`; `herdr_send(paneId: String, text: String, submit: bool) -> Result<(), String>`.

- [ ] **Step 1: Failing test — herdr-argv-Konstruktion**

`deliver.rs` mit reiner argv-Baufunktion (shell-frei testbar) anlegen:

```rust
//! Agent-native Zustellung in eine herdr-Pane. Reihenfolge der herdr-Aufrufe
//! wird als reine argv-Liste gebaut (testbar), dann ausgeführt.

/// Baut die herdr-Subcommand-Argumente für eine Zustellung.
/// Insert → nur `pane send-text`. Submit → zusätzlich `pane send-keys <pane> Enter`.
pub(crate) fn herdr_argvs(pane_id: &str, text: &str, submit: bool) -> Vec<Vec<String>> {
    let mut cmds = vec![vec![
        "pane".into(), "send-text".into(), pane_id.to_string(), text.to_string(),
    ]];
    if submit {
        cmds.push(vec![
            "pane".into(), "send-keys".into(), pane_id.to_string(), "Enter".into(),
        ]);
    }
    cmds
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_builds_only_send_text() {
        let cmds = herdr_argvs("wQ:p2", "hello", false);
        assert_eq!(cmds, vec![vec!["pane", "send-text", "wQ:p2", "hello"]]);
    }

    #[test]
    fn submit_appends_send_keys_enter() {
        let cmds = herdr_argvs("wQ:p2", "run tests", true);
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[1], vec!["pane", "send-keys", "wQ:p2", "Enter"]);
    }
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test`
Expected: FAIL (module `deliver` not found — nach Registrierung in Step 3 kompiliert es).

- [ ] **Step 3: Implement command + Enter**

`deliver.rs` um den Command ergänzen (nutzt `std::process::Command`, wie `detect.rs::query_herdr` mit 500 ms-Timeout-Muster; hier synchron über `spawn_blocking`):

```rust
use std::process::Command;

#[tauri::command]
pub async fn herdr_send(pane_id: String, text: String, submit: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for argv in herdr_argvs(&pane_id, &text, submit) {
            let status = Command::new("herdr")
                .args(&argv)
                .status()
                .map_err(|e| format!("herdr spawn failed: {e}"))?;
            if !status.success() {
                return Err(format!("herdr {argv:?} exited with {status}"));
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("herdr_send join failed: {e}"))?
}
```

In `paste.rs` `press_enter` ergänzen (kVK_Return = `0x24`), analog zu `synthesize_cmd_v`:

```rust
/// Virtual keycode `Return` (kVK_Return in Carbon's Events.h).
const KEY_RETURN: CGKeyCode = 0x24;

/// Synthesizes a single Return keystroke into the frontmost app. Used as the
/// submit step of the paste-fallback delivery path (herdr path submits itself).
#[tauri::command]
pub async fn press_enter() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
            .map_err(|_| "press_enter: could not create event source".to_string())?;
        for key_down in [true, false] {
            let event = CGEvent::new_keyboard_event(source.clone(), KEY_RETURN, key_down)
                .map_err(|_| "press_enter: could not create Return event".to_string())?;
            event.post(CGEventTapLocation::HID);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("press_enter join failed: {e}"))?
}
```

In `lib.rs`: `mod deliver;` neben den anderen `mod`-Zeilen; im `generate_handler!` ergänzen: `deliver::herdr_send,` und `paste::press_enter,`.

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test`
Expected: PASS. Zusätzlich `cargo build` erfolgreich (Command-Registrierung kompiliert).

- [ ] **Step 5: Commit**

Message: `✨ feat(macos): herdr_send + press_enter Delivery-Commands`

---

### Task 4: `activation.rs` — CGEventTap → PTT-Events

**Files:**
- Create: `apps/macos/src-tauri/src/activation.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs` (Event-Tap im `setup` starten)

**Interfaces:**
- Produces (Tauri-Events an die Frontend): `ptt:down` mit Payload `"insert"` | `"submit"`; `ptt:up` ohne Payload.
- Consumes: rechts-Cmd `0x36` → insert, rechts-Option `0x3D` → submit.

> Der Event-Tap selbst (CFRunLoop-Thread) ist nur mit laufender App verifizierbar (manuelle UAT, Task 8). Unit-getestet wird die **reine** Flag-Klassifikation.

- [ ] **Step 1: Failing test — `classify_flags_changed`**

`activation.rs` anlegen mit reiner Klassifikation + Tests:

```rust
//! Push-to-Talk-Aktivierung: ein CGEventTap auf `flagsChanged` übersetzt Halten/
//! Loslassen von rechts-Cmd/rechts-Option in ptt:down/ptt:up-Events. Die reine
//! Flag→Event-Abbildung ist unit-getestet; der Tap-Thread ist UAT-verifiziert.

use core_graphics::event::CGEventFlags;

/// Virtuelle Keycodes der rechten Modifier (Carbon Events.h).
const KEY_RIGHT_COMMAND: i64 = 0x36;
const KEY_RIGHT_OPTION: i64 = 0x3D;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Intent { Insert, Submit }

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PttEvent { Down(Intent), Up }

impl Intent {
    pub(crate) fn as_str(self) -> &'static str {
        match self { Intent::Insert => "insert", Intent::Submit => "submit" }
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
```

- [ ] **Step 2: Register module + run — expect FAIL then PASS for the pure fn**

In `lib.rs` `mod activation;` ergänzen.
Run: `cargo test classify_flags_changed` (bzw. `cargo test activation`)
Expected: PASS (reine Funktion). Falls die `CGEventFlags`-Konstanten-Namen in `core-graphics` 0.25 abweichen (`CGEventFlagCommand`/`CGEventFlagAlternate`), beim ersten `cargo build` korrigieren — die Bitflag-Semantik bleibt gleich.

- [ ] **Step 3: Implement the tap thread + start hook**

In `activation.rs` die Tap-Installation ergänzen (läuft auf eigenem Thread mit CFRunLoop; emittet über eine geklonte `AppHandle`):

```rust
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapPlacement, CGEventTapOptions, CGEventType, EventField,
};
use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes};
use tauri::{AppHandle, Emitter};

/// Startet den Push-to-Talk-Event-Tap auf einem dedizierten Thread. Fehler beim
/// Installieren werden geloggt; die App bleibt über den Toggle-Alias nutzbar.
pub(crate) fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let handler = move |_proxy: *const _, _etype: CGEventType, event: &core_graphics::event::CGEvent| {
            let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
            if let Some(ev) = classify_flags_changed(keycode, event.get_flags()) {
                match ev {
                    PttEvent::Down(intent) => { let _ = app.emit("ptt:down", intent.as_str()); }
                    PttEvent::Up => { let _ = app.emit("ptt:up", ()); }
                }
            }
            None // Event unverändert weiterreichen (passiver Tap).
        };

        let tap = match CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::FlagsChanged],
            handler,
        ) {
            Ok(t) => t,
            Err(_) => { eprintln!("[Verba] Konnte Push-to-Talk-Event-Tap nicht erstellen; nutze Toggle-Alias."); return; }
        };

        let loop_source = match tap.mach_port.create_runloop_source(0) {
            Ok(s) => s,
            Err(_) => { eprintln!("[Verba] Konnte Runloop-Source für Event-Tap nicht erstellen."); return; }
        };
        unsafe {
            CFRunLoop::get_current().add_source(&loop_source, kCFRunLoopCommonModes);
        }
        tap.enable();
        CFRunLoop::run_current();
    });
}
```

In `lib.rs` im `.setup(|app| { ... })`, nach `disable_app_nap()`:

```rust
#[cfg(target_os = "macos")]
activation::start(app.handle().clone());
```

> API-Namen, die beim ersten `cargo build` gegen `core-graphics` 0.25 / `core-foundation` 0.9 zu verifizieren sind: `CGEventTapOptions::ListenOnly`, `EventField::KEYBOARD_EVENT_KEYCODE`, `tap.mach_port.create_runloop_source`. Bei Abweichung 1:1 auf die vorhandenen Symbole der Crate-Version mappen (Semantik bleibt).

- [ ] **Step 4: Build — expect PASS**

Run: `cargo build`
Expected: kompiliert. (Der Tap wird in Task 8 mit laufender App manuell verifiziert.)

- [ ] **Step 5: Commit**

Message: `✨ feat(macos): Push-to-Talk-Event-Tap (rechts-Cmd/rechts-Option)`

---

### Task 5: `delivery.ts` — reines Zustell-Routing

**Files:**
- Create: `apps/macos/src/delivery.ts`
- Test: `apps/macos/test/unit/delivery.test.ts`

**Interfaces:**
- Produces: `type Intent = 'insert' | 'submit'`; `interface DeliveryPorts { detectSurface(): Promise<DetectedSurface>; herdrSend(paneId, text, submit): Promise<void>; paste(text): Promise<void>; pressEnter(): Promise<void>; }`; `deliver(text: string, intent: Intent, ports: DeliveryPorts): Promise<void>`.
- Consumes: `DetectedSurface` aus `@verba/core` (mit `paneId` aus Task 1).

- [ ] **Step 1: Failing tests — alle Routing-Zweige**

`apps/macos/test/unit/delivery.test.ts` (Mocha/assert, wie `controller.test.ts`):

```ts
import assert from 'node:assert/strict';
import { deliver, type DeliveryPorts } from '../../src/delivery';
import type { DetectedSurface } from '@verba/core';

function ports(surface: DetectedSurface, overrides: Partial<DeliveryPorts> = {}): DeliveryPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    detectSurface: async () => surface,
    herdrSend: async (paneId, _t, submit) => { calls.push(`herdr:${paneId}:${submit}`); },
    paste: async (_t) => { calls.push('paste'); },
    pressEnter: async () => { calls.push('enter'); },
    ...overrides,
  };
}

it('agent+paneId+submit → herdr send-text + submit, no paste', async () => {
  const p = ports({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' });
  await deliver('run tests', 'submit', p);
  assert.deepEqual(p.calls, ['herdr:wQ:p2:true']);
});

it('agent+paneId+insert → herdr send-text without submit', async () => {
  const p = ports({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' });
  await deliver('hello', 'insert', p);
  assert.deepEqual(p.calls, ['herdr:wQ:p2:false']);
});

it('agent+paneId, herdr throws → paste fallback (+enter on submit)', async () => {
  const p = ports({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' }, {
    herdrSend: async () => { throw new Error('herdr down'); },
  });
  // reuse calls via closure: rebuild with tracked paste/enter
  const calls: string[] = [];
  const p2: DeliveryPorts = {
    detectSurface: async () => ({ class: 'agent', agent: 'claude', paneId: 'wQ:p2' }),
    herdrSend: async () => { throw new Error('herdr down'); },
    paste: async () => { calls.push('paste'); },
    pressEnter: async () => { calls.push('enter'); },
  };
  await deliver('run tests', 'submit', p2);
  assert.deepEqual(calls, ['paste', 'enter']);
});

it('agent without paneId + submit → paste + enter', async () => {
  const calls: string[] = [];
  await deliver('go', 'submit', {
    detectSurface: async () => ({ class: 'agent', agent: 'codex' }),
    herdrSend: async () => { throw new Error('unused'); },
    paste: async () => { calls.push('paste'); },
    pressEnter: async () => { calls.push('enter'); },
  });
  assert.deepEqual(calls, ['paste', 'enter']);
});

it('generic surface + submit → paste only, never enter', async () => {
  const calls: string[] = [];
  await deliver('note text', 'submit', {
    detectSurface: async () => ({ class: 'generic' }),
    herdrSend: async () => { throw new Error('unused'); },
    paste: async () => { calls.push('paste'); },
    pressEnter: async () => { calls.push('enter'); },
  });
  assert.deepEqual(calls, ['paste']);
});

it('detectSurface throws → treated as generic → paste', async () => {
  const calls: string[] = [];
  await deliver('x', 'insert', {
    detectSurface: async () => { throw new Error('detect failed'); },
    herdrSend: async () => { throw new Error('unused'); },
    paste: async () => { calls.push('paste'); },
    pressEnter: async () => { calls.push('enter'); },
  });
  assert.deepEqual(calls, ['paste']);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:unit` (in `apps/macos`)
Expected: FAIL (`delivery` not found).

- [ ] **Step 3: Implement `deliver`**

`apps/macos/src/delivery.ts`:

```ts
import type { DetectedSurface } from '@verba/core';

/** Whether a dictation should be inserted only, or inserted and submitted. */
export type Intent = 'insert' | 'submit';

/** Injected primitives the router drives; wiring.ts supplies the Tauri-backed set. */
export interface DeliveryPorts {
	/** Current frontmost surface (detected at delivery time — the target is "now"). */
	detectSurface(): Promise<DetectedSurface>;
	/** Type text into the herdr pane; submit → also send Enter. */
	herdrSend(paneId: string, text: string, submit: boolean): Promise<void>;
	/** Clipboard + ⌘V paste into the frontmost app. */
	paste(text: string): Promise<void>;
	/** Synthetic Return into the frontmost app. */
	pressEnter(): Promise<void>;
}

/**
 * Routes a finished transcript to where it belongs:
 * - focused agent pane with a pane id → herdr (submit sends Enter itself);
 * - anything else → clipboard paste; Enter only follows on an agent surface.
 * The surface is detected here, at delivery time, so the target matches whatever
 * is frontmost now (same semantics the blind paste had).
 */
export async function deliver(text: string, intent: Intent, ports: DeliveryPorts): Promise<void> {
	const submit = intent === 'submit';
	let surface: DetectedSurface;
	try {
		surface = await ports.detectSurface();
	} catch {
		surface = { class: 'generic' };
	}

	if (surface.class === 'agent' && surface.paneId) {
		try {
			await ports.herdrSend(surface.paneId, text, submit);
			return;
		} catch {
			// herdr unreachable → fall through to the paste path below.
		}
	}

	await ports.paste(text);
	// Submit's Enter is an agent-only affordance; never fire it into Notes/editors.
	if (submit && surface.class === 'agent') {
		await ports.pressEnter();
	}
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

Message: `✨ feat(macos): Delivery-Routing (herdr-Pane vs. Paste-Fallback)`

---

### Task 6: `controller.ts` — Push-to-Talk-Handler + Delivery-Integration

**Files:**
- Modify: `apps/macos/src/controller.ts`
- Test: `apps/macos/test/unit/controller.test.ts`

**Interfaces:**
- Consumes: `deliver`, `Intent`, `DeliveryPorts` (Task 5).
- Produces: `DictationController.handlePttDown(intent: Intent)`, `handlePttUp()`; erweiterte `ControllerDeps { delivery: DeliveryPorts; holdThresholdMs?: number; schedule?: (fn: () => void, ms: number) => () => void }`.

- [ ] **Step 1: Failing tests — Threshold + Intent-Routing**

In `controller.test.ts` ergänzen (bestehende Fake-Deps um `delivery`, `schedule` erweitern; `schedule` als manuell feuerbarer Fake):

```ts
it('short tap (release before threshold) never records', async () => {
  let armed: (() => void) | null = null;
  const started: string[] = [];
  const c = makeController({
    schedule: (fn) => { armed = fn; return () => { armed = null; }; },
    invoke: async (cmd: string) => { started.push(cmd); return undefined as any; },
  });
  await c.handlePttDown('insert');
  await c.handlePttUp();               // released before the arm timer fired
  assert.ok(armed === null, 'arm timer was cancelled');
  assert.ok(!started.includes('start_capture'), 'no recording started');
});

it('hold past threshold records, release delivers with the held intent', async () => {
  let armed: (() => void) | null = null;
  const delivered: Array<{ text: string; intent: string }> = [];
  const c = makeController({
    schedule: (fn) => { armed = fn; return () => {}; },
    delivery: fakeAgentPorts((text, intent) => delivered.push({ text, intent })),
  });
  await c.handlePttDown('submit');
  armed!();                            // threshold elapsed → begins recording
  await tick();
  await c.handlePttUp();               // stop → transcribe → cleanup → deliver
  await tick();
  assert.equal(delivered.at(-1)?.intent, 'submit');
});
```

`makeController`, `fakeAgentPorts`, `tick` als lokale Helfer im Test (an das vorhandene Fake-Setup der Datei anlehnen). `fakeAgentPorts` liefert `DeliveryPorts`, deren `detectSurface` eine Agent-Surface mit `paneId` zurückgibt und dessen `herdrSend` den Callback triggert.

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:unit`
Expected: FAIL (`handlePttDown` not a function).

- [ ] **Step 3: Implement PTT + delivery**

Oben in `controller.ts` importieren:

```ts
import { deliver, type Intent, type DeliveryPorts } from './delivery';
```

`ControllerDeps` erweitern:

```ts
	delivery: DeliveryPorts;
	/** Minimum hold before a press starts recording (default 200ms). */
	holdThresholdMs?: number;
	/** Schedules `fn` after `ms`; returns a canceller. Injectable for tests. */
	schedule?: (fn: () => void, ms: number) => () => void;
```

Felder + Defaults im Konstruktor:

```ts
	private readonly holdThresholdMs: number;
	private readonly schedule: (fn: () => void, ms: number) => () => void;
	private intent: Intent = 'insert';
	private arming: { cancel: () => void } | null = null;
	private startInFlight = false;
	private pendingStop = false;
```

```ts
		this.holdThresholdMs = deps.holdThresholdMs ?? 200;
		this.schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
```

Neue Handler:

```ts
	/** Push-to-talk key pressed. Arms a hold timer; only a hold past the threshold records. */
	async handlePttDown(intent: Intent): Promise<void> {
		if (this.state !== 'idle' || this.arming || this.startInFlight) { return; }
		this.intent = intent;
		const cancel = this.schedule(() => { this.arming = null; void this.beginRecording(); }, this.holdThresholdMs);
		this.arming = { cancel };
	}

	/** Push-to-talk key released. Short tap → cancel; held → stop and deliver. */
	async handlePttUp(): Promise<void> {
		if (this.arming) { this.arming.cancel(); this.arming = null; return; }
		if (this.startInFlight) { this.pendingStop = true; return; }
		if (this.state === 'recording') { await this.stopAndTranscribe(); }
	}

	/** Starts capture once the hold threshold has elapsed; handles a release that races the start. */
	private async beginRecording(): Promise<void> {
		this.startInFlight = true;
		await this.startRecording();
		this.startInFlight = false;
		if (this.pendingStop) {
			this.pendingStop = false;
			if (this.state === 'recording') { await this.stopAndTranscribe(); }
		}
	}
```

Delivery-Block in `stopAndTranscribe` ersetzen (die bisherigen `paste_text`-Zeilen 171–179):

```ts
			try {
				await deliver(text, this.intent, this.deps.delivery);
				this.deps.notifier.info(this.intent === 'submit' ? 'Verba: sent.' : 'Verba: pasted.');
				this.deps.ui.setPhase('Idle.');
			} catch (err) {
				// The window is the fallback surface: the user must never lose text.
				this.deps.notifier.error(`Verba: delivery failed — ${errText(err)}`);
				await this.deps.ui.showTranscript(text);
			}
```

`handleHotkey` (Toggle-Alias) bleibt unverändert; es setzt `this.intent` nicht, sodass der Toggle-Pfad immer als `'insert'` zustellt (Default). Zur Klarheit am Anfang von `handleHotkey` beim Idle→Start `this.intent = 'insert';` setzen.

- [ ] **Step 4: Run — expect PASS**

Run: `npm run test:unit`
Expected: PASS (neue + bestehende Controller-Tests).

- [ ] **Step 5: Commit**

Message: `✨ feat(macos): Push-to-Talk-Handler + Delivery im DictationController`

---

### Task 7: Verdrahtung — `wiring.ts`, `main.ts`, `verbaConfig.ts`

**Files:**
- Modify: `apps/macos/src/wiring.ts` (DeliveryPorts bauen + injizieren)
- Modify: `apps/macos/src/main.ts` (PTT-Events listenen, gated auf Mode)
- Modify: `apps/macos/src/config/verbaConfig.ts` (`activation` durchreichen, falls nötig)

**Interfaces:**
- Consumes: `deliver`/`DeliveryPorts` (Task 5), `handlePttDown/Up` (Task 6), `ResolvedConfig.activation` (Task 1), `detect_surface`/`herdr_send`/`press_enter`/`paste_text` (IPC).

- [ ] **Step 1: Build DeliveryPorts in `wiring.ts`**

In `createDictationController` vor dem `new DictationController({...})` die Ports bauen (über `invoke`, `configState` geschlossen):

```ts
	const delivery = {
		detectSurface: () => invoke<DetectedSurface>('detect_surface', {
			agentMarkers: configState.current.agentMarkers,
			terminalApps: configState.current.terminalApps,
			editorApps: configState.current.editorApps,
		}),
		herdrSend: (paneId: string, text: string, submit: boolean) =>
			invoke<void>('herdr_send', { paneId, text, submit }),
		paste: (text: string) => invoke<void>('paste_text', { text }),
		pressEnter: () => invoke<void>('press_enter'),
	};
```

`DetectedSurface` ist bereits importiert. In das `new DictationController({...})`-Objekt aufnehmen:

```ts
		delivery,
		holdThresholdMs: configState.current.activation.holdThresholdMs,
```

Und `createDictationController` zusätzlich die aktuelle `activation` nach außen geben (für das Mode-Gate in `main.ts`):

```ts
	return { controller, reloadConfig, notifier, activationMode: () => configState.current.activation.mode };
```

Rückgabetyp entsprechend erweitern: `activationMode: () => 'push-to-talk' | 'toggle'`.

- [ ] **Step 2: Listen for PTT events in `main.ts`**

In `main.ts` nach dem bestehenden `register(HOTKEY, …)` ergänzen (`listen` ist bereits importiert):

```ts
	const { controller, reloadConfig, notifier, activationMode } = await createDictationController();
	// … bestehende config-Listener + controller.init() …

	// Push-to-Talk (primär). Der Toggle-Hotkey oben bleibt als Alias/Rückfall.
	void listen<string>('ptt:down', (event) => {
		if (activationMode() !== 'push-to-talk') { return; }
		void controller.handlePttDown(event.payload === 'submit' ? 'submit' : 'insert');
	});
	void listen('ptt:up', () => {
		if (activationMode() !== 'push-to-talk') { return; }
		void controller.handlePttUp();
	});
```

(Die Destrukturierung von `createDictationController()` in Zeile 9 um `activationMode` erweitern.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` (in `apps/macos`)
Expected: keine Fehler.

- [ ] **Step 4: Full TS unit run**

Run: `npm run test:unit`
Expected: PASS (Regression-Check; Wiring hat keine eigenen Unit-Tests, wird in Task 8 manuell verifiziert).

- [ ] **Step 5: Commit**

Message: `✨ feat(macos): Push-to-Talk + herdr-Delivery verdrahten`

---

### Task 8: Manuelle UAT (laufende App)

**Files:**
- Create: `docs/superpowers/uat/2026-07-24-voice-to-agent-push-uat.md` (Ergebnisprotokoll)

Nicht headless verifizierbar (Event-Tap, Accessibility, echte herdr-Pane). Mit `just macos-dev` (kompiliert core automatisch) starten und protokollieren:

- [ ] **Step 1: Build & Launch**

Run: `just macos-dev`
Voraussetzung: Accessibility-Permission erteilt; herdr läuft mit einem fokussierten Agenten (`herdr api snapshot` zeigt `"focused": true` mit `pane_id`).

- [ ] **Step 2: Insert-Geste** — rechts-Cmd halten, sprechen, loslassen. Erwartung: Text erscheint in der fokussierten herdr-Pane (kein Enter). HUD durchläuft recording ▸ transcribing ▸ processing ▸ idle.

- [ ] **Step 3: Submit-Geste** — rechts-Option halten, ein kurzes Kommando sprechen, loslassen. Erwartung: Text erscheint **und** wird abgesendet (Enter). Falls das Enter nicht auslöst: `send-keys`-Key-Namen prüfen (`Enter` vs. `Return`) und in `deliver.rs::herdr_argvs` anpassen.

- [ ] **Step 4: Kurzer Tap** — rechts-Cmd nur antippen. Erwartung: keine Aufnahme, kein HUD-Flackern.

- [ ] **Step 5: Nicht-Agent-Fallback** — in einer Nicht-Terminal-App (z. B. Notes) rechts-Option halten und sprechen. Erwartung: Text wird gepastet, **kein** Enter (Submit ist agent-only).

- [ ] **Step 6: herdr-aus-Fallback** — herdr stoppen, in einem Terminal rechts-Cmd halten/sprechen. Erwartung: Fallback auf ⌘V-Paste, kein Hänger.

- [ ] **Step 7: Toggle-Alias** — `Ctrl+Alt+D` drücken/erneut drücken. Erwartung: klassischer Toggle-Flow funktioniert weiterhin (immer insert).

- [ ] **Step 8: Ergebnisse protokollieren + committen**

Ergebnisse (inkl. verifizierter API-Namen aus Task 4 und `send-keys`-Key aus Step 3) ins UAT-Dokument schreiben.
Message: `📝 docs(uat): Voice→Agent-Push UAT-Ergebnisse`

---

## Self-Review

**Spec-Coverage** (gegen `2026-07-24-voice-to-agent-push-design.md`):
- Push-to-Talk rechts-Cmd/rechts-Option via Event-Tap → Task 4 (+ Config Task 1).
- Submit nur auf Agent-Surfaces → `deliver()` (Task 5) + UAT Step 5.
- herdr-Injection `pane send-text`/`send-keys Enter` → Task 3 (`herdr_argvs`) + Task 2 (`pane_id`).
- Paste-Fallback (+ synthetisches Enter) → Task 3 (`press_enter`) + Task 5 Routing.
- Toggle-Alias erhalten → Task 6 (`handleHotkey` unverändert) + Task 7 Mode-Gate + UAT Step 7.
- Hold-Threshold → Task 6 (`arming`/`schedule`) + UAT Step 4.
- Config-Keys `activation.*` → Task 1.
- Degradation (Accessibility, herdr-aus, kein pane_id, leeres Transkript) → Task 5 + bestehender Controller-Pfad + UAT Steps 5/6.
- Nur fokussierte Pane (YAGNI) → `detect.rs` liefert genau den fokussierten Agenten; kein Picker.

**Placeholder-Scan:** keine TODO/TBD; jeder Code-Schritt zeigt echten Code. Zwei bewusst markierte Verifikationspunkte (core-graphics-API-Namen in Task 4; `send-keys`-Key-Name in Task 8) sind Feasibility-Checks mit laufender App, keine offenen Anforderungen.

**Typ-Konsistenz:** `Intent`/`DeliveryPorts`/`deliver` (Task 5) exakt so in Task 6/7 konsumiert; `paneId` (Wire-Name) einheitlich in Rust-Serde (Task 2), `DetectedSurface` (Task 1) und `delivery.ts` (Task 5); IPC-Command-Namen `herdr_send`/`press_enter` identisch in Task 3 (Rust) und Task 7 (wiring).
