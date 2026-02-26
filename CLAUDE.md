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

Alle Phasen sind Sub-Issues von TF-243 (Projektuebersicht). Alle Kernphasen sind abgeschlossen.

### Abgeschlossen

- **TF-244: Extension Grundgeruest** - Done. Command `dictation.start` mit Tastenkuerzel, Extension-Grundstruktur.
- **TF-245: Mikrofon-Aufnahme** - Done. ffmpeg-Kindprozess fuer Audioaufnahme, Statusbar-Feedback, Cross-Platform (macOS/Linux/Windows).
- **TF-246: Whisper API Transkription** - Done. OpenAI Whisper Integration, API Key via SecretStorage.
- **TF-247: Claude Post-Processing** - Done. Anthropic Claude Integration, Fuellwoerter-Entfernung, Pipeline-Architektur.
- **TF-248: Konfigurierbare Prompt-Templates** - Done. Quick-Pick-Menue, 8 Standard-Templates (inkl. 3 context-aware: Code Comment, Explain Code, Claude Code Prompt), frei erweiterbar via `settings.json`.
- **TF-249: Marktanalyse** - Done. Konkurrenzanalyse (Wispr Flow, Superwhisper, Willow Voice, VoiceInk, etc.).
- **TF-250: Terminal-Unterstuetzung** - Done. Diktat in Terminal einfuegen, `verba.terminal.executeCommand` Setting.
- **Cross-Platform Audio-Aufnahme** - Done. macOS (AVFoundation), Linux (PulseAudio), Windows (DirectShow) mit konfigurierbarer Geraeteauswahl auf allen Plattformen (Quick Pick + `verba.audioDevice` Setting). Geraete-Listing via avfoundation (macOS), pactl (Linux), dshow (Windows). ffmpeg v7 und v8+ Format-Erkennung, PowerShell-Fallback auf Windows.
- **Streaming Post-Processing** - Done. `processStreaming()` mit Echtzeit-Fortschrittsanzeige in der Statusbar (Zeichenzaehler), AbortController-Unterstuetzung zum Abbrechen, robustes Error-Handling (401/429).
- **Course Correction** - Done. Erkennung und Entfernung von Selbstkorrekturen im Diktat ("nein warte, doch X" → nur X). Geteilte `COURSE_CORRECTION_INSTRUCTION` in Default-Cleanup und Template-Framing.
- **Voice Commands** - Done. Sprachgesteuerte Formatierungsbefehle ("Neuer Absatz", "Punkt", "Aufzaehlung") per Prompt-Engineering. Sprachunabhaengig, immer aktiv. Geteilte `VOICE_COMMANDS_INSTRUCTION` in Default-Cleanup und Template-Framing.

## Git-Workflow

- **Branching:** `main` ist der stabile Release-Branch, `develop` ist der Integrations-Branch
- **PRs immer `feature/*` -> `develop`** — niemals direkt auf `main`
- **Releases:** `develop` wird in `main` gemerged wenn ein Release ansteht
- **Feature-Branches:** `feature/<issue-id>-<beschreibung>` (z.B. `feature/tf-250-terminal-dictation`)

## Konventionen

- Extension-Name: `verba`
- Command-Prefix: `dictation.`
- Hauptcommand: `dictation.start` (`Cmd+Shift+D` / `Ctrl+Shift+D`)
- Terminal-Command: `dictation.startFromTerminal` (gleiche Tastenkuerzel, wenn Terminal fokussiert)
- Audio-Device-Command: `dictation.selectAudioDevice` (Mikrofon-Auswahl via Quick Pick)
- Template-Command: `dictation.selectTemplate` (`Cmd+Alt+T` / `Ctrl+Alt+T`) — Template-Wechsel ohne Aufnahme
- API Keys werden ausschliesslich ueber `vscode.SecretStorage` gespeichert (nie im Klartext)
- TypeScript strict mode
- VS Code Extension Best Practices befolgen

## Architektur

```
Mikrofon --> ffmpeg (WAV) --> Whisper API --> Claude API --> Editor/Terminal
                                              (Template)
```

| Modul | Aufgabe |
|-------|---------|
| `recorder.ts` | ffmpeg-Kindprozess fuer Audioaufnahme (macOS/Linux/Windows) |
| `transcriptionService.ts` | OpenAI Whisper API Integration |
| `cleanupService.ts` | Anthropic Claude API Integration (Streaming + Course Correction) |
| `pipeline.ts` | Verkettung der Verarbeitungsstufen |
| `templatePicker.ts` | Quick-Pick-Menue fuer Template-Auswahl |
| `insertText.ts` | Texteinfuegung in Editor oder Terminal |
| `statusBarManager.ts` | Statusbar-Anzeige (Idle/Recording/Transcribing/Processing mit Zeichenzaehler) |
