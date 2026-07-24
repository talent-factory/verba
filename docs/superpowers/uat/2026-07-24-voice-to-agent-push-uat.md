# UAT — Voice→Agent Push (TF-525)

**Feature:** Agent-native Zustellung auf macOS — Push-to-Talk auf rechts-Cmd (einfügen) / rechts-Option (einfügen + absenden), Text direkt in die fokussierte herdr-Pane (`herdr pane send-text` (+ `send-keys Enter`)), Fallback auf ⌘V-Paste. Ersetzt für den Agent-Fall den blinden Paste.
**Branch:** `feature/tf-525-voice-to-agent-push` → `develop`
**Spec:** `docs/superpowers/specs/2026-07-24-voice-to-agent-push-design.md`
**Plan:** `docs/superpowers/plans/2026-07-24-voice-to-agent-push.md`
**Stand:** 2026-07-24 · Plattform: **nur macOS**

---

## Was die automatisierten Tests bereits abdecken

Alles grün, muss **nicht** manuell nachgeprüft werden:

| Suite | Umfang |
|-------|--------|
| `@verba/core` (173 Tests) | `activation`-Config-Schema (Defaults, per-Field-Fallback, invalider `mode`), `DetectedSurface.paneId` |
| macOS TS (94 Tests) | `deliver()`-Routing (alle 6 Zweige: agent+paneId ins/sub, herdr-throws-Fallback, agent-ohne-paneId, generic, detect-throws), PTT-Handler inkl. Hold-Threshold-Cancel und `pendingStop`-Race, Arm-Identity-Guard gegen Doppel-Start, Delivery-Migration |
| Rust (`cargo test`, 69 Tests) | `classify_flags_changed` (rechts-Cmd/rechts-Option × Down/Up, Ignore-Fall), `detect_surface` pane_id-Parsing, `herdr_argvs` (send-text / send-keys Enter) |

**Diese UAT prüft manuell nur, was Tests nicht können:** die Live-CGEventTap-Geste, echte herdr-Pane-Injection und das Absende-Enter, Accessibility, den Paste-Fallback, sowie die Graceful-Degradation im Realbetrieb.

---

## Vorbereitung

1. **Immer** `just macos-dev` verwenden (kompiliert `@verba/core` vor dem Start automatisch; ein direktes `npm run tauri dev` tut das **nicht** → toter Hotkey durch stale `dist/`).
2. API-Keys im Keychain hinterlegen (Prompt beim ersten Diktat oder via Tray): Deepgram + Anthropic.
3. **Accessibility-Berechtigung** erteilen (Systemeinstellungen ▸ Datenschutz ▸ Bedienungshilfen) — für den Event-Tap **und** Paste.
4. **herdr** läuft mit mindestens einem Agenten; ein Pane fokussiert. Prüfen mit `herdr api snapshot` → der fokussierte Agent hat `"focused": true` und eine `"pane_id"`.
5. **Logs sichtbar machen:** die `stderr`-Ausgabe des `just macos-dev`-Terminals beobachten (`[Verba] …`).
6. Config-Datei: `~/.config/verba/config.json` (top-level bare keys, **kein** `verba.`-Prefix). Relevante Keys: `activation.mode` (`push-to-talk` default | `toggle`), `activation.holdThresholdMs` (default 200).

> **Beobachtungs-Trick:** Welches Template pro Diktat gewählt wurde, ist im UI nicht sichtbar. Auf einer Agent-Oberfläche sollte der Output eine knappe, imperative Anweisung sein (Agent-Instruction-Cleanup), nicht bereinigte Prosa.

---

## Testfälle

Legende: ⬜ offen · ✅ Pass · ❌ Fail (mit Notiz)

| # | Fall | Schritte | Erwartung | Status |
|---|------|----------|-----------|--------|
| 1 | **Insert-Geste** | rechts-Cmd halten → sprechen → loslassen (fokussierte herdr-Pane) | Text erscheint in der Pane, **kein** Enter. HUD: recording ▸ transcribing ▸ processing ▸ idle | ✅ |
| 2 | **Submit-Geste** | rechts-Option halten → kurzes Kommando → loslassen | Text erscheint **und** wird abgesendet (Enter) | ✅ |
| 3 | **Kurzer Tap** | rechts-Cmd nur antippen (< 200 ms) | Keine Aufnahme, kein HUD-Flackern | ✅ |
| 4 | **Nicht-Agent + Submit** | in Notes rechts-Option halten → sprechen | Text gepastet, **kein** Enter (Submit ist agent-only) | ✅ |
| 5 | **herdr-aus-Fallback** | herdr stoppen → im Terminal rechts-Cmd halten → sprechen | Fallback auf ⌘V-Paste, kein Hänger | ✅ |
| 6 | **Toggle-Alias** | `Ctrl+Alt+D` drücken / erneut drücken | Klassischer Toggle-Flow funktioniert weiter (immer insert) | ✅ |
| 7 | **Editor-Oberfläche** | in VS Code / einem Editor rechts-Cmd halten → sprechen | Text landet im Editor (Paste-Pfad), kein Agent-Verhalten | ✅ |
| 8 | **Leeres Diktat** | rechts-Cmd halten → nichts / nur Stille → loslassen | Kein leeres Enter an den Agenten; Warn-/Fehler-Notification | ✅ |

---

## Zu verifizierende offene Feasibility-Punkte (aus Spec/Review)

Beim Durchspielen gezielt beobachten und Ergebnis notieren:

- ✅ **`send-keys`-Key-Name:** Absende-Enter (Fall 2) feuert mit `"Enter"` — kein Wechsel auf `"Return"` nötig (im Live-Test bestätigt).
- ⬜ **Event-Tap-Install-Notification:** Ohne Accessibility (oder bei Tap-Fehler) sollte jetzt eine **Notification** erscheinen („Push-to-Talk konnte nicht aktiviert werden … nutze Ctrl+Alt+D"), keine Stille. Einmal ohne Accessibility-Recht testen.
- ⬜ **⌘-Shortcut-Interferenz:** Stört das Halten von rechts-Cmd während des ~200 ms-Fensters echte ⌘-Shortcuts?
- ⬜ **Concurrent-Modifier-Edge:** rechts-Cmd loslassen, während links-Cmd gehalten wird — Fehlklassifikation als zweites Down? (bekannter Edge, `classify_flags_changed` nutzt das aggregierte Flag)
- ⬜ **Doppel-Delivery-Edge:** Wenn `send-text` klappt, aber `send-keys Enter` fehlschlägt → fällt TS auf Paste+Enter zurück (Text doppelt). Nur relevant, falls in der Praxis reproduzierbar.
- ⬜ **cpal-Teardown-Zusammenspiel:** Interagiert der Event-Tap mit der App-Nap-/„Transkribiere"-Freeze-Absicherung?

---

## Bekannte, bewusst zurückgestellte Fast-Follows (kein UAT-Blocker)

- `activation.holdThresholdMs` wird nicht live-reloaded (nur bei Neustart wirksam — anders als `activation.mode`).
- `activation.insertKey` / `activation.submitKey` sind **reserved**: der Tap hardcodet rechts-Cmd (`0x36`) / rechts-Option (`0x3D`); Custom-Keycodes noch nicht verdrahtet.

---

## Ergebnis

**Abnahme:** ✅ 

Notizen / Findings:

- **#8 war zunächst fälschlich ✅** — der „no-empty-Enter"-Teil hielt (leerer
  Transkript wirft vor der Zustellung, kein Enter an den Agenten), aber die
  erwartete Warn-Notification erschien nie. Ursache diagnostiziert: der
  macOS-Notification-Kanal fiel auf **drei gestapelten Achsen** still aus, keine
  davon ein Code-Bug:
  1. **Zustellung:** `just macos-dev` startet das unbundled Dev-Binary
     (`target/debug/verba-macos`); macOS liefert `UNUserNotificationCenter`-
     Notifications aus einem Prozess ohne echten `.app`-Bundle-Kontext nicht aus.
     Im gebauten Bundle (`just macos-build` → `Verba.app`) kamen sie sofort.
  2. **Berechtigung:** „Mitteilungen" für Verba war in den Systemeinstellungen
     aus → `sendNotification` = stiller No-op; nach „Nicht erlauben" re-promptet
     macOS nicht wieder.
  3. **Vorschau-Maskierung:** „Vorschau zeigen" ≠ „Immer" → Body wird durch den
     Platzhalter „Mitteilung" ersetzt, der konkrete Hinweis erreicht den Nutzer
     nicht.
- **Live-Fund (Secure-Input, iTerm2):** In einem Terminal mit „Secure Keyboard
  Entry" bleibt der Transkript korrekt auf der Zwischenablage (Commit `7e0eb23`),
  aber der Hinweis „⌘V zum Einfügen" erreichte den Nutzer im Dev-Modus nie —
  dieselbe Achse 1.
- **Fix in Arbeit:** HUD-Spiegel für die drei handlungsrelevanten Meldungen
  (Secure-Input, leeres Diktat, Zustellungsfehler), unabhängig vom fragilen
  Notification-Kanal — Spec `docs/superpowers/specs/2026-07-24-hud-message-mirror-design.md`.
- **Re-Test erledigt (2026-07-24):** Nach dem HUD-Spiegel-Fix (Commits
  `599c696..0eb6588`, im gebauten `Verba.app` verifiziert) bestätigte der Nutzer
  im Live-Test: **alle Fälle inkl. #8 und Secure-Input funktionieren** — die drei
  handlungsrelevanten Meldungen sind über die HUD-Pille sichtbar, unabhängig vom
  fragilen Notification-Kanal. **UAT abgeschlossen / abgenommen.**
