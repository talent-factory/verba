# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **API Key Management:** `dictation.manageApiKeys` command to view (masked), update, or delete stored OpenAI and Anthropic API keys via the Command Palette.
- **LLM Cost Tracking & Overview (TF-270):** `dictation.showCostOverview` command opens a WebView panel showing per-model API usage costs. Tracks Whisper transcription (by audio duration), Claude processing (by input/output tokens), and OpenAI Embeddings (by prompt tokens). Costs displayed per session and accumulated across all sessions, grouped by provider (OpenAI / Anthropic) in a card layout with VS Code theme support.

## [0.3.0] - 2026-02-26

### Added

- **Offline Transcription (TF-257):** Local transcription via whisper.cpp CLI as an alternative to OpenAI Whisper API. Audio never leaves the machine. Strategy pattern on `TranscriptionService` with `setProvider('openai'|'local')`.
- **Model Download:** GGML models from Hugging Face via `dictation.downloadModel` command with progress indicator and cancellation support. Model selection: tiny, base, small, medium, large.
- **Provider Display in Status Bar:** Tooltip shows active provider (OpenAI Whisper / Local whisper.cpp), transcribing state displays provider explicitly.
- **Streaming Post-Processing:** Claude responses are received via streaming with real-time progress display in the status bar (e.g. "Processing... 182 chars"). Dictation can be cancelled during processing by pressing the shortcut again.
- **Course Correction:** Self-corrections in dictation are automatically detected and removed (e.g. "no wait, actually Friday" → "Friday"). Active in all modes (freeform and templates).
- **Voice Commands:** Spoken formatting commands are recognized and applied (e.g. "New paragraph", "Period", "Bullet point"). Works language-independently in all modes.
- **Glossary/Dictionary:** Terms (product names, technical terms, abbreviations) are preserved exactly during transcription and cleanup. Global terms via `verba.glossary` setting, project-specific via `.verba-glossary.json`.
- **JSDoc Documentation:** All public APIs across 13 source files documented.

### Fixed

- SIGKILL escalation for hanging whisper-cli processes
- Provider validation with fallback for invalid settings
- Minimum file size check after model download

### Changed

- Marketplace homepage link updated to `talent-factory.xyz`
- Marketplace category changed from `Other` to `Snippets`

## [0.2.0] - 2026-02-24

### Added

- **Configurable Prompt Templates (TF-248):** 5 default templates (Freeform, Commit Message, JavaDoc, Markdown, Email) with full customization via `verba.templates` setting
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
