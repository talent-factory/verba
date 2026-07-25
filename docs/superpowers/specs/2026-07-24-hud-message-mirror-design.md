# Design — HUD-Spiegel für handlungsrelevante Meldungen (macOS)

**Datum:** 2026-07-24
**Plattform:** nur macOS (`apps/macos`)
**Status:** freigegeben (Design), Implementierung ausstehend
**Kontext-Branch:** `feature/tf-525-voice-to-agent-push`

## Motivation

Die macOS-App meldet handlungsrelevante Zustände (Secure-Input-Terminal → „⌘V zum
Einfügen", leeres Diktat, Zustellungsfehler) ausschließlich über native
Notification-Banner (`TauriNotifier` → `sendNotification`). Dieser Kanal fällt im
Beta-Alltag auf mehreren voneinander unabhängigen Achsen still aus:

1. **Zustellung:** `just macos-dev` / `npm run tauri dev` startet das **unbundled
   Dev-Binary** (`target/debug/verba-macos`). macOS liefert
   `UNUserNotificationCenter`-Notifications aus einem Prozess ohne echten
   `.app`-Bundle-Kontext nicht aus — obwohl der Code `sendNotification` korrekt
   aufruft. Da die Beta **build-from-source** ist und CLAUDE.md `just macos-dev`
   als Startweg dokumentiert, trifft das jeden Beta-Nutzer.
2. **Berechtigung:** Ist „Mitteilungen" für Verba in den Systemeinstellungen aus,
   ist `sendNotification` ein stiller No-op. Nach einem einmaligen „Nicht erlauben"
   re-promptet macOS nicht wieder.
3. **Inhaltsmaskierung:** Steht „Vorschau zeigen" nicht auf „Immer", ersetzt macOS
   den Body durch den generischen Platzhalter „Mitteilung" — der konkrete Hinweis
   erreicht den Nutzer nicht.

Diagnose-Historie: Alle drei Achsen wurden in einer UAT-Session zu TF-525
beobachtet (der Secure-Input-Hinweis kam in iTerm2 nie an). Achse 2 und 3 sind
nutzerseitig behebbar; **Achse 1 ist es nicht** — sie ist der Kern.

Die HUD-Pille (`hud.rs` + `apps/macos/src/hud/hud.ts`) funktioniert dagegen
nachweislich unabhängig von Berechtigung, Bundling und Vorschau-Setting (der
Nutzer sah durchgehend „Transkribiere …"). Sie ist damit die einzige verlässliche
Fläche für handlungsrelevantes Feedback.

## Ziel

Die **drei handlungsrelevanten** Meldungen zusätzlich zur Notification kurz in der
HUD-Pille spiegeln, sodass der Nutzer sie auch dann sieht, wenn der
Notification-Kanal (Dev-Modus, Berechtigung, Vorschau) versagt.

**Explizit kein** Ersatz der Notifications — die Spiegelung ergänzt sie.

## Umfang

Gespiegelt werden genau diese drei Fälle (die übrigen Flow-Zustände
Aufnahme/Transkribiere/Verarbeite zeigt das HUD ohnehin schon):

| Fall | Auslöser (controller.ts) | Severity | Icon | HUD-Label | Accent |
|------|--------------------------|----------|------|-----------|--------|
| Secure-Input | `deliver()` → `'secure-input'` (Erfolgs-Branch) | warn | ⚠ | `⌘V zum Einfügen` | `#f5a623` |
| Leeres Diktat | äußerer `catch`, `err instanceof NoSpeechError` | error | 🔇 | `Keine Sprache erkannt` | `#e5484d` |
| Zustellungsfehler | `deliver()`-`catch` (`delivery failed`) | error | ⚠ | `Zustellung fehlgeschlagen` | `#e5484d` |

**Dauer:** `HUD_MESSAGE_MS = 5000` (5 s), danach Auto-Ausblenden.

**Fehler-Unterscheidung im äußeren `catch`:** Der äußere `catch` fängt heute
mehrere Fehlertypen (leeres Diktat, `StopCaptureTimeoutError`, generische
Transkriptions-/API-Fehler) und ruft für alle `notifier.error`. Nur der
**No-Speech-Fall** wird gespiegelt — unterschieden über einen **typisierten Fehler
`NoSpeechError`** (nicht per String-Match auf die englische Message). Das folgt dem
bestehenden Muster (`CleanupTimeoutError`, `StopCaptureTimeoutError` werden schon
via `instanceof` unterschieden). `StopCaptureTimeoutError` und generische Fehler
bleiben **notification-only** (siehe Nicht-enthalten).

### Nicht enthalten (bewusst, YAGNI)

- **`init()`-„Mitteilungen-aus"-Warnung.** Sie würde den Dev-Fall (Achse 1) gar
  nicht fangen — dort ist die Berechtigung ggf. „granted", nur die Zustellung
  scheitert. Separater Fast-Follow, falls überhaupt.
- Spiegelung von Routine-Infos (`recording…`, `pasted.`/`sent.`) und der
  Cleanup-Timeout/Skip-Warnungen — würde das HUD verrauschen.
- Spiegelung von `StopCaptureTimeoutError` (Aufnahme-Finalize-Hänger) und
  generischen Transkriptions-/API-Fehlern (z. B. Deepgram-401/Netz) — bleiben
  notification-only. Bewusst außerhalb der drei freigegebenen Fälle; möglicher
  Fast-Follow.
- Keine Interaktion mit der Meldung (das HUD bleibt click-through/non-focused —
  das ist eine harte Invariante, siehe `hud.rs`: ein fokussiertes HUD stiehlt den
  Fokus und der Paste-⌘V landet in Verba statt im Zielfenster).

## Ansatz (gewählt: A — Lebenszyklus in TypeScript, HUD bleibt dumm)

Rust erhält nur ein zustandsloses `set_hud_message`, das die Pille mit
`{label, icon, accent}` non-focused/click-through zeigt. Das Timing lebt im
Controller über den bereits injizierten Scheduler-Seam. Voll in der TS-Unit-Suite
abgedeckt; kein Rust-Mutex/async-Timer.

Verworfene Alternative **B** (Timer + Generation-Counter in Rust): sauber
gekapselt, aber Rust-seitiger Mutex-State + async-Task, schlechter testbar.

## Kernproblem und Lösung: das `finally`-Idle

`stopAndTranscribe()` beendet jeden Pfad mit `finally { this.setState('idle') }`
(controller.ts:267) → HUD versteckt sich sofort. Eine Meldung, die im Branch davor
gezeigt würde, würde umgehend verdeckt.

**Lösung:** Statt im Branch sofort zu zeigen, wird die Meldung in einem Feld
`pendingHudMessage` vorgemerkt. Der `finally`-Block spielt sie aus, statt idle zu
setzen — er zeigt die HUD-Meldung und plant das HUD-Idle nach `HUD_MESSAGE_MS`
über `this.schedule`.

## Komponenten

### Core — `packages/core/src/transcription.ts`

Neuer typisierter Fehler `NoSpeechError extends Error`. `validateTranscript` wirft
ihn (statt `new Error(...)`) für den leeren/silence-only-Fall. Additiv und
rückwärtskompatibel: der VS-Code-Host fängt ihn weiterhin als `Error`. Export über
`@verba/core`. **Achtung:** Core-Änderung → `npm run compile:core` nötig, damit die
Hosts den neuen Export aus `dist/` sehen (`just macos-*` erledigt das automatisch).

### Rust — `apps/macos/src-tauri/src/hud.rs`

Neuer Command `set_hud_message(label, icon, accent)`: identisch zum Non-Idle-Pfad
von `set_hud_state`, aber vom `DictationState` entkoppelt — emittiert `hud:state`
mit dem `HudPayload` (derselbe Renderer in `hud.ts` genügt), positioniert
bottom-center, `set_ignore_cursor_events(true)`, `set_always_on_top(true)`,
`show()` **ohne** `set_focus`. No-op, wenn kein `hud`-Fenster existiert.
Registrierung in `lib.rs` (`invoke_handler`).

### Frontend — `apps/macos/src/visualization/`

- **`messagePresentation.ts`** (neu, rein): `Severity = 'warn' | 'error'`;
  `messagePresentationFor(severity) → { icon, accent }`. Einzige Quelle der
  Severity-Optik.
- **`visualization.ts`**: neue Methode
  `showMessage(text: string, severity: Severity): void`. Setzt **Tray auf idle**
  (`set_tray_state` idle — der Flow ist fertig) **und** zeigt die HUD-Meldung
  (`set_hud_message` mit `label = text`, `icon`/`accent` aus
  `messagePresentationFor`). Best-effort (Fehler geloggt/geschluckt wie `setState`).

### Controller — `apps/macos/src/controller.ts`

- `ControllerUi` (Zeile 8) erhält `showMessage(text: string, severity: Severity): void`.
- Neues privates Feld `pendingHudMessage: { text: string; severity: Severity } | null`
  und `hudMessageTimer: (() => void) | null`.
- Die drei Branches setzen `this.pendingHudMessage = { text, severity }` neben dem
  bestehenden `notifier.warn/error` (kurze deutsche Copy laut Tabelle, **nicht** der
  lange englische Notifier-String).
- `finally` (Zeile 267):
  ```
  if (this.pendingHudMessage) {
    const msg = this.pendingHudMessage;
    this.pendingHudMessage = null;
    this.surfaceHudMessage(msg.text, msg.severity);
  } else {
    this.setState('idle');
  }
  ```
- Neue private Methode `surfaceHudMessage(text, severity)`: `this.state = 'idle'`
  (logischer Zustand ist idle); `this.deps.ui.showMessage(text, severity)`; laufenden
  `hudMessageTimer` abbrechen; dann
  `this.hudMessageTimer = this.schedule(() => { this.hudMessageTimer = null; this.deps.ui.setState('idle'); }, HUD_MESSAGE_MS)`.
- **Supersession:** `private setState(state)` (Zeile 110) bricht bei jedem
  Übergang in einen **Nicht-Idle-Zustand** einen laufenden `hudMessageTimer` ab
  (die neue Aufnahme übernimmt die Pille; sonst würde der 5-s-Timer mitten in der
  neuen Aufnahme `setState('idle')` feuern und das HUD verstecken).

### Wiring — `apps/macos/src/wiring.ts`

`ui`-Objekt um `showMessage: visualization.showMessage` erweitern.

## Datenfluss

```
secure-input / leeres Diktat / Zustellungsfehler
        │  Branch: notifier.warn/error(...)  +  this.pendingHudMessage = { text, severity }
        ▼
finally:  pendingHudMessage gesetzt?
        ├─ ja → surfaceHudMessage(text, severity)
        │        ├─ ui.showMessage → set_tray_state(idle) + set_hud_message(label,icon,accent) → Pille zeigt Meldung
        │        └─ schedule(HUD_MESSAGE_MS) → ui.setState('idle') → HUD versteckt
        └─ nein → setState('idle')

neue Aufnahme währenddessen → setState('recording') → hudMessageTimer abgebrochen, Pille übernimmt
```

## Testing

**TypeScript (bestehende `apps/macos/src/test/unit`-Suite, injizierter Fake-Scheduler):**
- Für **jeden** der drei Branches: `ui.showMessage` wird mit korrektem Text +
  Severity gerufen; `notifier.warn/error` weiterhin ebenfalls (Spiegelung, kein
  Ersatz).
- Nach Ablauf von `HUD_MESSAGE_MS` (Fake-Scheduler auslösen) folgt
  `ui.setState('idle')` → HUD versteckt.
- Das `finally`-Idle verdeckt die Meldung **nicht** (kein sofortiges
  `setState('idle')`, wenn `pendingHudMessage` gesetzt ist).
- **Supersession:** startet vor Timer-Ablauf eine neue Aufnahme
  (`setState('recording')`), wird der Meldungs-Timer abgebrochen und feuert kein
  späteres `setState('idle')`.
- Der Normalpfad (pasted/sent) surft **keine** HUD-Meldung und idlet sofort.
- Ein **Nicht**-No-Speech-Fehler im äußeren `catch` (z. B.
  `StopCaptureTimeoutError`) surft **keine** HUD-Meldung — nur `notifier.error`.

**Core (`packages/core` Suite):**
- `validateTranscript` wirft bei leer/silence-only einen `NoSpeechError`
  (`instanceof`), bei gültigem Text kein Fehler — bestehende Contract-Tests
  entsprechend anpassen.

**Rust (`cargo test`):**
- `messagePresentation`-Analog ist TS-seitig; Rust-Test deckt `set_hud_message`
  als No-op ohne `hud`-Fenster ab (analog zu bestehendem `set_hud_state`-Verhalten).

## Offene Nebenpunkte (nicht Teil dieser Änderung)

- UAT-Protokoll `docs/superpowers/uat/2026-07-24-voice-to-agent-push-uat.md`: Fall
  #8 war fälschlich als ✅ markiert (Banner fehlte, weil Mitteilungen aus) — separat
  korrigieren; Findings zur Notification-Zustellung ergänzen.
```
