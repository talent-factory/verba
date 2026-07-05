# macOS Paste + Cleanup Design (TF-518, M3-Abschluss)

**Datum:** 2026-07-03
**Linear:** [TF-518](https://linear.app/talent-factory/issue/TF-518)
**Ziel:** Diktierter Text landet bereinigt in jeder macOS-App — nicht mehr nur im Verba-Fenster. Damit ist das M3-Milestone aus `docs/development/phase-1-macos-app.md` abgeschlossen.

## Entscheidungen

| Frage | Entscheid |
|---|---|
| UX nach Paste | Fenster bleibt unsichtbar, Notification-Toast als Bestätigung. Fenster erscheint nur bei Fehlern oder fürs Accessibility-Onboarding. |
| Cleanup ohne Anthropic-Key / bei API-Fehler | Raw-Fallback: rohes Transkript wird gepastet, Warn-Toast. Diktat blockiert nie. |
| Paste-Mechanismus | Nur Clipboard+⌘V (sichern → setzen → CGEvent ⌘V → restaurieren). AX-Insertion ist gestrichen (unaufgelöster Spike, zwei Codepfade, geringer Nutzen); später als Enhancement möglich. |
| Cleanup-Transport | `@anthropic-ai/sdk` direkt im WebView mit `dangerouslyAllowBrowser: true` (Anthropic unterstützt direkten Browser-Zugriff offiziell via CORS). Fallback-Plan bei CORS/CSP-Problemen: Tauri-HTTP-Plugin als custom `fetch` ans SDK. |

## Architektur & Datenfluss

```
Hotkey (Stop) → stop_capture (WAV)
             → deepgram_transcribe (Rust, bestehend)
             → CleanupService.process()          [neu, mit Raw-Fallback]
             → has_accessibility_permission?     [bestehend]
                ├─ nein → showAccessibilityOnboarding + showTranscript (bestehend)
                └─ ja  → paste_text (Rust, neu)
                          ├─ ok  → Toast «Pasted», Fenster bleibt verborgen
                          └─ err → Fenster zeigen + showTranscript (Text geht nie verloren)
```

### Komponenten

| Komponente | Änderung |
|---|---|
| `apps/macos/src-tauri/src/paste.rs` | Neuer Command `paste_text(text: String)` — Pasteboard sichern/setzen/⌘V/restaurieren |
| `apps/macos/src-tauri/Cargo.toml` | Neue Crates: `arboard` (Clipboard), `core-graphics` (CGEvent) |
| `apps/macos/src-tauri/src/lib.rs` | `paste::paste_text` im `invoke_handler` registrieren |
| `packages/core/src/cleanupService.ts` | Optionaler Konstruktor-Parameter `clientOptions`, durchgereicht an `new Anthropic({ apiKey, ...clientOptions })` |
| `apps/macos/src/controller.ts` | `dangerouslyAllowBrowser: true`; Cleanup + Paste in `stopAndTranscribe()`; Raw-Fallback; neue `processing`-Phase |
| `apps/macos/src/ui.ts` | Nur neuer Phasen-Text; `showTranscript` bleibt Fallback-Anzeigepfad |
| `apps/macos/src-tauri/tauri.conf.json` | CSP `connect-src` um `https://api.anthropic.com` ergänzen |

## Rust: `paste_text` im Detail

`pub async fn paste_text(text: String) -> Result<(), String>` — async, damit die Sleeps den Main-Thread nicht blockieren (Muster wie `deepgram_transcribe`).

1. **Clipboard sichern:** Text-Inhalt via `arboard` lesen. Nicht-Text-Inhalte (Bilder, Dateien) werden in v1 nicht restauriert — dokumentierte Einschränkung. Leeres Clipboard ist kein Fehler.
2. **Transkript setzen:** `set_text(text)`.
3. **⌘V synthetisieren:** CGEvent-Paar (KeyDown/KeyUp, Keycode 9 = `V`, `CGEventFlags::MaskCommand`) auf den HID-Event-Tap posten. ~50ms Wartezeit vor dem Event (Pasteboard-Propagation).
4. **Restore verzögert:** ~300ms warten, dann alten Inhalt zurückschreiben (Ziel-App liest das Pasteboard asynchron — zu frühes Restore pastet den alten Inhalt).
5. **Fehler:** jeder Schritt mappt auf `Err(String)`. Fehlgeschlagenes Restore ist nur ein Warn-Log — der Paste war erfolgreich.

**Permission-Zusammenspiel:** `CGEvent::post` erfordert die Accessibility-Permission (bestehender Check `has_accessibility_permission()`). Controller ruft `paste_text` nur bei erteilter Permission auf. Wird die Permission zwischen Check und Paste entzogen, schlägt das Event still fehl → deshalb der Fenster-Fallback.

## TypeScript: Core-Änderung & Controller-Wiring

**`packages/core`:** `clientOptions?: Partial<ClientOptions>` am `CleanupService`-Konstruktor, Spread in `getClient()`. Kein Verhaltensunterschied für die VS-Code-Extension (übergibt nichts). Neuer Test: Durchreichung.

**`apps/macos/src/controller.ts` — `stopAndTranscribe()` neu:**

1. Transkript validieren (wie bisher)
2. Cleanup-Versuch: `cleanup.process(transcript)` in try/catch. Prompt-Abbruch (kein Key) oder API-Fehler → `text = transcript` + Warn-Toast («Cleanup skipped — pasting raw transcript»)
3. Permission-Gate (bestehend): ohne Permission → Onboarding-UI + `showTranscript(text)`
4. Paste: `invoke('paste_text', { text })` → Erfolg: Toast «Pasted». Fehler: Fenster + `showTranscript(text)`

**Anthropic-Key-Prompt:** bestehender `promptForApiKey`-Dialog, Keychain via `TauriSecretStore` — exakt wie beim Deepgram-Key.

## Verifikation

**Automatisiert:**
- Rust: `cargo test` (Clipboard-Roundtrip lokal, in CI übersprungen; Konstanten-Test Keycode/Flags), `cargo clippy -- -D warnings`
- TS: `npm run typecheck`, Vitest in `apps/macos` (gemockter `invoke`: Cleanup-Erfolg, Raw-Fallback, Paste-Fehler → Fenster-Fallback)
- Core: `npm test` in `packages/core`

**Manuell (Akzeptanz gemäss TF-518):**
1. TextEdit → Hotkey → diktieren → bereinigter Text in TextEdit, Fenster unsichtbar, Toast
2. Terminal → gleicher Flow
3. Clipboard-Restore: vorher kopierter Text ist nach dem Paste wieder im Clipboard
4. Anthropic-Key-Prompt abbrechen → rohes Transkript gepastet, Warn-Toast
5. Accessibility-Permission entziehen → Onboarding-UI wie bisher

## Explizit ausgeklammert (M4)

Streaming-Cleanup-Feedback, Template-Picker, Glossar/Expansions-Wiring in der macOS-App, AX-Value-Insertion, Restore von Nicht-Text-Clipboard-Inhalten.

## Abschluss

- M3-Eintrag in `docs/development/phase-1-macos-app.md` auf ✅ aktualisieren
- TF-518 auf Done
