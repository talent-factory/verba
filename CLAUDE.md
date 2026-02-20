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
- **TF-248: Konfigurierbare Prompt-Templates** - Done. Quick-Pick-Menue, 5 Standard-Templates, frei erweiterbar via `settings.json`.
- **TF-249: Marktanalyse** - Done. Konkurrenzanalyse (Wispr Flow, Superwhisper, Willow Voice, VoiceInk, etc.).
- **TF-250: Terminal-Unterstuetzung** - Done. Diktat in Terminal einfuegen, `verba.terminal.executeCommand` Setting.
- **Cross-Platform Audio-Aufnahme** - Done. macOS (AVFoundation), Linux (PulseAudio), Windows (DirectShow) mit automatischer Geraeteerkennung.

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
| `cleanupService.ts` | Anthropic Claude API Integration |
| `pipeline.ts` | Verkettung der Verarbeitungsstufen |
| `templatePicker.ts` | Quick-Pick-Menue fuer Template-Auswahl |
| `insertText.ts` | Texteinfuegung in Editor oder Terminal |
| `statusBarManager.ts` | Statusbar-Anzeige (Idle/Recording/Transcribing) |
