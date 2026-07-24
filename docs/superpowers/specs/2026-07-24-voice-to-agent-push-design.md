# Voice → Agent: Push (Keil #2, Sub-Projekt A)

**Datum:** 2026-07-24
**Projekt:** [Verba](https://linear.app/talent-factory/project/verba-the-developers-dictation-extension-8227f12a5e2c/) · Linear-Issue: [TF-525](https://linear.app/talent-factory/issue/TF-525)
**Strategie:** Keil #2 der Positionierung „Voice zum Kommandieren von KI-Agenten" (siehe Memory `project_verba_positioning_agent_voice`). Gegner ist **Spokenly** (MCP-Integration für Claude Code/Cursor), nicht Wispr.
**Ziel:** Diktat auf einer macOS-Agent-Oberfläche wird **agent-nativ** aktiviert und zugestellt — Push-to-Talk auf einer merkbaren Taste, Text direkt in die fokussierte herdr-Pane, optional abgesendet. Ersetzt für den Agent-Fall den blinden ⌘V-Paste.

## Kontext & Abgrenzung

Verbas Erkennung ist seit PR#46 agent-aware: `detect_surface` (`apps/macos/src-tauri/src/detect.rs`) liefert über herdr (Tier 1), AX-Fenstertitel (Tier 2) und NSWorkspace (Tier 3) den fokussierten Agenten als `Surface::Agent { agent, status }`. Das steuert heute **nur die Template-Wahl** (Agent-Instruction-Cleanup). Die **Zustellung** ist weiterhin ein blinder synthetischer ⌘V-Paste (`paste_text`, `paste.rs`).

Keil #2 zerfällt in zwei unabhängige Subsysteme, die je einen eigenen Spec→Plan→Build-Zyklus bekommen:

- **Sub-Projekt A — Push (dieses Dokument):** *Du* initiierst; Verba stellt agent-nativ zu.
- **Sub-Projekt B — Pull (MCP-Server):** *Der Agent* zieht Stimme bei Rückfragen (`ask_user_dictation`-Äquivalent). Eigener, späterer Zyklus.

Der „eine Identität"-Kitt: beide Schleifen füttern denselben `@verba/core`-Cleanup mit dem Agent-Instruction-Template. Nur Auslöser und Zustellweg unterscheiden sich.

## Entscheidungen

| Frage | Entscheid |
|---|---|
| Aktivierung | **Push-to-Talk** auf nackten Modifier-Tasten via CGEventTap. `activation.mode: "push-to-talk"` (default), `"toggle"` als Rückfall. |
| Tasten-Modell | **rechts-Cmd** (`0x36`) halten = einfügen · **rechts-Option** (`0x3D`) halten = einfügen + absenden. Je eine merkbare Taste pro Aktion, kein Chord (Modell X). |
| Warum Event-Tap statt `global-shortcut` | Nackte Modifier-Tasten kann Tauris `global-shortcut`-Plugin nicht binden; `core-graphics` ist über `paste.rs` bereits im Projekt. |
| Submit-Reichweite | Das „absenden"-Enter feuert **nur auf Agent-Surfaces**. Auf Nicht-Agent-Surfaces verhält sich rechts-Option wie rechts-Cmd (nur einfügen). Hält „absenden = Agent-Sache" sauber. |
| Toggle-Hotkey (`Ctrl+Alt+D`) | Bleibt als **optionaler Alias** registriert — Sicherheitsnetz bei fehlgeschlagenem Event-Tap und für Langform-Diktat. |
| Zustellung Agent + herdr | `herdr agent send <agent> <text>`; bei submit zusätzlich `herdr pane send-keys <pane_id> Enter`. |
| Zustellung sonst (kein herdr / Nicht-Agent) | Bestehender `paste_text` (⌘V); bei submit + Nicht-herdr synthetisches Enter dahinter. |
| Pane-Targeting | Nur die **fokussierte** Agent-Pane. Kein Pane-Picker (YAGNI v1). |
| Hold-Threshold | ~200 ms, bevor eine Aufnahme startet — verhindert 0-Längen-Spam bei kurzem Tap. |

## Architektur & Komponenten

Vier Einheiten, jede mit einer Aufgabe und testbarer Schnittstelle:

**1. Aktivierungsschicht — neu, Rust (`src-tauri/src/activation.rs`).**
CGEventTap lauscht auf `flagsChanged` für rechts-Cmd (`0x36`) und rechts-Option (`0x3D`). Down → Tauri-Event `ptt:down { intent }`, Up → `ptt:up`. Die Keycode→Intent-Abbildung ist pure Funktion (unit-testbar ohne Event-Tap). Hold-Threshold verwirft kurze Taps.

**2. Delivery-Router — neu, TS im Controller + Rust-Command.**
Nimmt `(Surface, intent)` → Aktion:
- `Surface::Agent` **mit** pane_id → `herdr agent send`, bei submit + `herdr pane send-keys <pane_id> Enter`.
- sonst → `paste_text`; bei submit + Nicht-herdr Paste + synthetisches Enter.
- Neuer Rust-Command `deliver_to_agent(agent, pane_id, text, submit)` shellt zu `herdr` aus — wie `detect.rs` es lesend schon tut (500 ms-Timeout, identischer Wert).

**3. `detect.rs` — Erweiterung.**
Gibt heute `agent` + `status`; für `send-keys Enter` zusätzlich die **pane_id** des fokussierten Agenten aus dem Snapshot ziehen. `agent send` selbst braucht nur das Label; pane_id nur für den Submit-Schritt. Die JSON-Parse-Tests (`focused_herdr_agent_from_json`) werden mit-erweitert.

**4. Controller — Fluss-Umbau (`controller.ts`).**
Von Toggle zu Start/Stop: `ptt:down` → Capture start (`audio.rs`); `ptt:up` → Capture stop → transkribieren → cleanup → `detect_surface` → Delivery-Router(intent). Der Controller bleibt frei von `@tauri-apps/api` (Adapter injiziert), damit das Routing testbar bleibt.

## Datenfluss (Submit-Fall, herdr)

```
rechts-Option down ─▶ activation.rs (Event-Tap) ─▶ ptt:down{submit}
   ─▶ Controller: Capture start (audio.rs) ─▶ [User spricht] ─▶ rechts-Option up
   ─▶ ptt:up ─▶ Capture stop ─▶ Deepgram (transcribe.rs) ─▶ @verba/core Cleanup
      (Agent-Instruction-Template via detect_surface) ─▶ detect_surface → Agent{agent, pane_id}
   ─▶ deliver_to_agent(agent, pane_id, text, submit=true)
      ─▶ herdr agent send <agent> <text>  +  herdr pane send-keys <pane_id> Enter
HUD spiegelt idle ▸ recording ▸ transcribing ▸ processing durchgehend.
```

Der Insert-Fall (rechts-Cmd) ist identisch, nur ohne den `send-keys Enter`-Schritt.

## Fehlerbehandlung & Degradation

Jede Schicht fällt sicher zurück — der Diktat-Fluss bricht nie hart ab:

- **Kein Accessibility-Recht** (Event-Tap *und* Paste brauchen es): bestehender Onboarding-Deep-Link; Aktivierung bleibt beim `Ctrl+Alt+D`-Alias.
- **Event-Tap lässt sich nicht installieren:** Fallback auf Toggle-Alias + einmalige Notification.
- **herdr nicht erreichbar / Call-Fehler / Timeout:** Router fällt auf `paste_text` zurück; bei submit Paste + synthetisches Enter.
- **Agent nur per Titel-Marker erkannt (Tier 2, keine pane_id):** kein `send-keys` möglich → Paste-Pfad (+ Enter bei submit).
- **Leeres Transkript / Cleanup-Fehler:** nicht zustellen, bestehende Fehler-Notification. Kein leeres Enter an den Agenten.
- **Tap unter Hold-Threshold:** keine Aufnahme, kein No-op-Artefakt.

## Testing

- **Rust, pure:** Keycode→Intent-Map (`0x36`→insert, `0x3D`→submit); pane_id-Extraktion aus Snapshot-JSON (erweitert bestehende Tests); herdr-argv-Konstruktion (`agent send`, `send-keys`) — alles ohne laufendes herdr.
- **TS, Controller mit Fake-Adaptern:** Delivery-Routing `(Surface, intent) → Aktion` über alle Zweige (Agent+herdr, Agent+Paste-Fallback, Nicht-Agent); Submit-vs-Insert.
- **Stall-Pfade** (Memory `feedback_test_stall_not_just_throw`): herdr-Call als nie-auflösendes Promise + Timeout, nicht nur als throw.
- **Manuelle UAT** (nur mit laufender App, Memory-Muster `feedback_uat_install_vsix` sinngemäß): Event-Tap-Geste rechts-Cmd/rechts-Option, echte herdr-Pane-Injection, Submit-Enter. Event-Tap ist nicht headless verifizierbar.

## Config (`~/.config/verba/config.json`, `@verba/core`-Schema)

Bare-Keys, kein `verba.`-Prefix (Memory `apps/macos config schema`). Neu:

- `activation.mode`: `"push-to-talk"` (default) | `"toggle"`
- `activation.insertKey` / `activation.submitKey`: Default `"right-command"` / `"right-option"`
- `activation.holdThresholdMs`: Default `200`
- `agentMarkers` / `terminalApps` / `editorApps`: bereits vorhanden, wiederverwendet.

## Nicht-Ziele (YAGNI v1)

- **Multi-Pane-Targeting** — nur die fokussierte Agent-Pane.
- **Pull / MCP-Server** — Sub-Projekt B, eigener Zyklus.
- **Modell Y** (Return-während-Aufnahme) — verworfen.
- **Beliebig konfigurierbare Keycodes** über das Insert/Submit-Paar hinaus — Defaults shippen.
- **Windows/Linux** — macOS-App only.

## Offene Punkte (mit laufender App zu verifizieren)

- CGEventTap auf nackten rechts-Modifier: Unterscheidung L/R via Keycode im `flagsChanged`-Tap bestätigen; Interferenz mit echten Cmd-Shortcuts bei kurzem Halten prüfen.
- `herdr agent send` / `pane send-keys` Exit-Codes und Verhalten bei nicht-fokussierter/beendeter Pane.
- Zusammenspiel Event-Tap ↔ bestehender App-Nap-/cpal-Teardown-Absicherung (Memory `project_macos_cpal_teardown_hang`).
