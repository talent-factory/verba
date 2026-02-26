# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-02-26

### Added

- **Offline-Transkription (TF-257):** Lokale Transkription via whisper.cpp CLI als Alternative zur OpenAI Whisper API. Audio verlässt nie den Rechner. Strategy-Pattern auf `TranscriptionService` mit `setProvider('openai'|'local')`.
- **Model-Download:** GGML-Modelle von Hugging Face via `dictation.downloadModel` Command mit Fortschrittsanzeige und Abbruchmoeglichkeit. Modellauswahl: tiny, base, small, medium, large.
- **Provider-Anzeige in Statuszeile:** Tooltip zeigt aktiven Provider (OpenAI Whisper / Local whisper.cpp), Transcribing-State zeigt Provider explizit an.
- **Streaming Post-Processing:** Claude-Antworten werden per Streaming empfangen mit Echtzeit-Fortschrittsanzeige in der Statusbar (z.B. "Processing... 182 chars"). Diktat kann waehrend der Verarbeitung per erneutem Tastendruck abgebrochen werden.
- **Course Correction:** Selbstkorrekturen im Diktat werden automatisch erkannt und entfernt (z.B. "nein warte, doch Freitag" → "Freitag"). Aktiv in allen Modi (Freitext und Templates).
- **Voice Commands:** Gesprochene Formatierungsbefehle werden erkannt und umgesetzt (z.B. "Neuer Absatz", "Punkt", "Aufzaehlung"). Funktioniert sprachunabhaengig in allen Modi.
- **Glossar/Dictionary:** Begriffe (Produktnamen, Fachbegriffe, Abkuerzungen) werden bei Transkription und Bereinigung exakt beibehalten. Globale Begriffe via `verba.glossary` Setting, projektspezifische via `.verba-glossary.json`.
- **JSDoc-Dokumentation:** Alle oeffentlichen APIs ueber 13 Source-Dateien dokumentiert.

### Fixed

- SIGKILL-Eskalation bei haengenden whisper-cli Prozessen
- Provider-Validierung mit Fallback bei ungueltigem Setting
- Minimale Dateigroesse-Pruefung nach Model-Download

### Changed

- Marketplace homepage link updated to `talent-factory.xyz`
- Marketplace category changed from `Other` to `Snippets`

## [0.2.0] - 2026-02-24

### Added

- **Configurable Prompt Templates (TF-248):** 5 default templates (Freitext, Commit Message, JavaDoc, Markdown, E-Mail) with full customization via `verba.templates` setting
- Context-Aware Dictation with semantic code search via grepai or OpenAI Embeddings
- 3 context-aware templates: Code Comment, Explain Code, Claude Code Prompt
- `dictation.indexProject` command to build a local embeddings index for context search
- `verba.contextSearch.provider` setting (`auto`, `grepai`, `openai`) and `verba.contextSearch.maxResults` setting
- GitHub Actions changelog preview workflow: posts a categorized changelog preview as a PR comment when opening PRs to `main`
- Template Quick-Pick selection menu integrated into dictation workflow
- Template auto-reuse: last used template is automatically reused, Quick Pick only on first use
- `dictation.selectTemplate` command (`Cmd+Alt+T` / `Ctrl+Alt+T`) to change template without starting a recording
- Status bar shows active template name in idle state
- Pipeline context architecture for dynamic system prompt passing to Claude
- **Cross-Platform Audio Device Selection:** macOS (AVFoundation), Linux (PulseAudio), Windows (DirectShow)
- `dictation.selectAudioDevice` command for microphone selection on any platform
- `verba.audioDevice` setting for manual microphone configuration
- Windows-specific ffmpeg search paths (Chocolatey, Scoop, WinGet, Program Files)
- PowerShell fallback (`Win32_SoundDevice`) when ffmpeg finds no Windows audio devices
- **Marketplace Publishing:** extension icon (SVG/PNG), screenshots, workflow GIF
- Open-source governance files: MIT License, Code of Conduct, Security Policy
- Semantic-release configuration with emoji-aware conventional commit parsing
- GitHub Actions release workflow for automated versioning on merge to `main`

### Fixed

- Template shortcut changed from `Cmd+Shift+T` to `Cmd+Alt+T` to avoid conflict with VS Code's built-in shortcut
- CHANGELOG.md included in VSIX package for the Marketplace Changelog tab
- Git identity configured for GitHub Actions release commits (`github-actions[bot]`)
- Extension bundled with esbuild to fix activation failure
- Transcript wrapped in XML tags to prevent Claude generating conversational responses instead of clean output
- Terminal focus detection rewritten with two separate commands and mutually exclusive `when` clauses
- Template prompt wrapped with framing context for reliable output format
- Windows audio recording: robust device detection supporting both ffmpeg v7 (section-based) and v8+ (inline `(audio)`) output formats
- Audio device selection enabled for macOS and Linux (previously only Windows)
- `make dev` workflow compatible with Windows/Cygwin
- `install:local` npm script now works cross-platform

## [0.1.1] - 2026-02-20

### Added

- Terminal dictation: `dictation.startFromTerminal` command inserts dictated text into the active terminal
- `verba.terminal.executeCommand` setting to auto-execute dictated text as a terminal command
- Shared keybinding `Cmd+Shift+D` / `Ctrl+Shift+D` with context-aware routing (terminal vs editor)
- Whisper silence/hallucination detection (recordings with only dots/ellipsis are rejected)
- Debug logging throughout the transcription and cleanup pipeline
