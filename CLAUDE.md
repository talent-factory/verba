# Verba - The Developer's Dictation Extension

## Projekt

Native VS Code Extension fuer sprachgesteuertes Diktieren mit KI-gestuetztem Post-Processing.
Powered by OpenAI Whisper (Transkription) und Claude API (Post-Processing).

**Positionierung:** The Developer's Dictation Extension
**Repository:** git@github.com:talent-factory/verba.git
**Linear-Projekt:** https://linear.app/talent-factory/project/verba-the-developers-dictation-extension-8227f12a5e2c/

## Tech Stack

- **Sprache:** TypeScript
- **Plattform:** VS Code Extension API (Electron/Node.js)
- **Transkription:** OpenAI Whisper API (`openai` npm package)
- **Post-Processing:** Anthropic Claude API (`@anthropic-ai/sdk` npm package)
- **API Keys:** Bring-Your-Own-Key via `vscode.SecretStorage`

## USPs

1. **Echte VS Code-Integration** - Native Extension, kein System-Level-Tool. Cursor-Position, aktiver Editor, Datei-Kontext verfuegbar.
2. **Developer-spezifische Prompt-Templates** - Commit-Messages, JavaDoc, Code-Kommentare, Markdown, E-Mails. Konfigurierbar via `settings.json`.
3. **Bring-Your-Own-Key** - Eigene OpenAI + Anthropic Keys. Keine Abo-Kosten, volle Datenkontrolle.

## Implementierungsphasen (Linear Issues)

Alle Phasen sind Sub-Issues von TF-243 (Projektuebersicht, In Progress).

### Phase 1: Extension Grundgeruest (TF-244) - Status: Todo

- Extension-Grundgeruest mit `yo code` generieren (TypeScript)
- Command `dictation.start` registrieren (Tastenkuerzel `Ctrl+Shift+D`)
- Dummy-Text an Cursor-Position einfuegen (Proof of Concept)
- Extension im Extension Development Host testen
- **Akzeptanz:** `Ctrl+Shift+D` fuegt Testtext an Cursorposition ein, kompiliert fehlerfrei

### Phase 2: Mikrofon-Aufnahme (TF-245) - Status: Backlog

- Recherche: Node.js vs. WebView fuer Audioaufnahme in VS Code
- Start/Stop-Aufnahme per Command implementieren
- Audio als temporaere WAV/MP3-Datei speichern
- Visuelles Feedback via Statusbar-Indikator
- **Akzeptanz:** Aufnahme startet/stoppt via Tastenkuerzel, Audiodatei abspielbar, Statusbar zeigt Aufnahmestatus

### Phase 3: Whisper API Transkription (TF-246) - Status: Backlog

- OpenAI API Key konfigurierbar via `vscode.SecretStorage`
- `openai` npm Package integrieren
- Audiodatei an `whisper-1` Model senden
- Transkript empfangen und in Editor einfuegen
- Fehlerbehandlung (kein API Key, Netzwerkfehler)
- **Akzeptanz:** Gesprochener Text erscheint an Cursor-Position, API Key sicher gespeichert

### Phase 4: Claude Post-Processing (TF-247) - Status: Backlog

- Anthropic API Key in SecretStorage integrieren
- `@anthropic-ai/sdk` npm Package integrieren
- Standard-Prompt: Fuellwoerter entfernen ("aehm", "aeh", "halt", "eigentlich"), Saetze glaetten
- Pipeline: Transkript -> Claude -> bereinigter Text -> Editor
- **Akzeptanz:** Fuellwoerter zuverlaessig entfernt, Sinn erhalten, Latenz < 5s gesamt

### Phase 5: Konfigurierbare Prompt-Templates (TF-248) - Status: Backlog

- Template-Struktur in `settings.json` (Name, Prompt, Tastenkuerzel)
- Standard-Templates: Freitext, Commit Message, JavaDoc, Markdown, E-Mail
- Quick-Pick Menue zum Template-Wechsel vor der Aufnahme
- Templates vollstaendig vom User anpassbar und erweiterbar
- **Akzeptanz:** Eigene Templates in settings.json, Quick-Pick zeigt alle Templates

### Abgeschlossen

- **TF-249: Marktanalyse** - Done. Konkurrenzanalyse (Wispr Flow, Superwhisper, Willow Voice, VoiceInk, etc.) mit Identifikation der Marktluecken.

## Konventionen

- Extension-Name: `verba`
- Command-Prefix: `dictation.`
- Hauptcommand: `dictation.start` (`Ctrl+Shift+D`)
- API Keys werden ausschliesslich ueber `vscode.SecretStorage` gespeichert (nie im Klartext)
- TypeScript strict mode
- VS Code Extension Best Practices befolgen

## Abhaengigkeiten zwischen Phasen

```
Phase 1 (Grundgeruest) -> Phase 2 (Mikrofon) -> Phase 3 (Whisper) -> Phase 4 (Claude) -> Phase 5 (Templates)
```

Jede Phase baut auf der vorherigen auf. Phase 1 ist der naechste Schritt.
