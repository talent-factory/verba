# Verba - The Developer's Dictation Extension

## Project

Native VS Code extension for voice dictation with AI-powered post-processing.
Powered by OpenAI Whisper (transcription) and Claude API (post-processing).

**Positioning:** The Developer's Dictation Extension
**Repository:** git@github.com:talent-factory/verba.git
**Linear Project:** https://linear.app/talent-factory/project/verba-the-developers-dictation-extension-8227f12a5e2c/

## Tech Stack

- **Language:** TypeScript
- **Platform:** VS Code Extension API (Electron/Node.js)
- **Transcription:** OpenAI Whisper API (`openai` npm package)
- **Post-Processing:** Anthropic Claude API (`@anthropic-ai/sdk` npm package)
- **API Keys:** Bring-Your-Own-Key via `vscode.SecretStorage`

## USPs

1. **Native VS Code Integration** - Native extension, not a system-level tool. Cursor position, active editor, file context available.
2. **Developer-Specific Prompt Templates** - Commit messages, JavaDoc, code comments, Markdown, emails. Configurable via `settings.json`.
3. **Bring-Your-Own-Key** - Own OpenAI + Anthropic keys. No subscription costs, full data control.

## Implementation Phases (Linear Issues)

All phases are sub-issues of TF-243 (project overview). All core phases are completed.

### Completed

- **TF-244: Extension Scaffold** - Done. Command `dictation.start` with keyboard shortcut, extension base structure.
- **TF-245: Microphone Recording** - Done. ffmpeg child process for audio recording, status bar feedback, cross-platform (macOS/Linux/Windows).
- **TF-246: Whisper API Transcription** - Done. OpenAI Whisper integration, API key via SecretStorage.
- **TF-247: Claude Post-Processing** - Done. Anthropic Claude integration, filler word removal, pipeline architecture.
- **TF-248: Configurable Prompt Templates** - Done. Quick Pick menu, 8 default templates (incl. 3 context-aware: Code Comment, Explain Code, Claude Code Prompt), freely extensible via `settings.json`.
- **TF-249: Market Analysis** - Done. Competitive analysis (Wispr Flow, Superwhisper, Willow Voice, VoiceInk, etc.).
- **TF-250: Terminal Support** - Done. Insert dictation into terminal, `verba.terminal.executeCommand` setting.
- **Cross-Platform Audio Recording** - Done. macOS (AVFoundation), Linux (PulseAudio), Windows (DirectShow) with configurable device selection on all platforms (Quick Pick + `verba.audioDevice` setting). Device listing via avfoundation (macOS), pactl (Linux), dshow (Windows). ffmpeg v7 and v8+ format detection, PowerShell fallback on Windows.
- **Streaming Post-Processing** - Done. `processStreaming()` with real-time progress display in the status bar (character counter), AbortController support for cancellation, robust error handling (401/429).
- **Course Correction** - Done. Detection and removal of self-corrections in dictation ("no wait, actually X" → only X). Shared `COURSE_CORRECTION_INSTRUCTION` in default cleanup and template framing.
- **Voice Commands** - Done. Voice-driven formatting commands ("New paragraph", "Period", "Bullet point") via prompt engineering. Language-independent, always active. Shared `VOICE_COMMANDS_INSTRUCTION` in default cleanup and template framing.
- **Glossary/Dictionary** - Done. Protected terms during transcription (Whisper `prompt` parameter) and cleanup (Claude prompt instruction). Global terms via `verba.glossary` setting, project-specific via `.verba-glossary.json`. `setGlossary()` on CleanupService, `glossary` parameter on TranscriptionService.
- **TF-257: Offline Transcription** - Done. Local transcription via whisper.cpp CLI as alternative to Whisper API. Strategy pattern on `TranscriptionService` with `setProvider('openai'|'local')`. Model download via `dictation.downloadModel` command (Hugging Face). Settings: `verba.transcription.provider`, `verba.transcription.localModel`. macOS support (Linux/Windows planned).

## Git Workflow

- **Branching:** `main` is the stable release branch, `develop` is the integration branch
- **PRs always `feature/*` -> `develop`** — never directly to `main`
- **Releases:** `develop` is merged into `main` when a release is due
- **Feature Branches:** `feature/<issue-id>-<description>` (e.g. `feature/tf-250-terminal-dictation`)

## Conventions

- **CHANGELOG.md is always written in English** — all entries, descriptions, and examples must be in English
- Extension name: `verba`
- Command prefix: `dictation.`
- Main command: `dictation.start` (`Cmd+Shift+D` / `Ctrl+Shift+D`)
- Terminal command: `dictation.startFromTerminal` (same shortcut when terminal is focused)
- Audio device command: `dictation.selectAudioDevice` (microphone selection via Quick Pick)
- Template command: `dictation.selectTemplate` (`Cmd+Alt+T` / `Ctrl+Alt+T`) — switch template without recording
- API key management: `dictation.manageApiKeys` — view (masked), update, or delete stored API keys
- API keys are stored exclusively via `vscode.SecretStorage` (never in plaintext)
- TypeScript strict mode
- Follow VS Code Extension best practices

## Architecture

```
Microphone --> ffmpeg (WAV) --> Whisper API     --> Claude API --> Editor/Terminal
                            \-> whisper.cpp CLI /   (Template)
```

| Module | Purpose |
|--------|---------|
| `recorder.ts` | ffmpeg child process for audio recording (macOS/Linux/Windows) |
| `transcriptionService.ts` | Transcription via OpenAI Whisper API or local whisper.cpp CLI (glossary hints) |
| `cleanupService.ts` | Anthropic Claude API integration (streaming, course correction, voice commands, glossary) |
| `pipeline.ts` | Processing stage orchestration |
| `templatePicker.ts` | Quick Pick menu for template selection |
| `insertText.ts` | Text insertion into editor or terminal |
| `statusBarManager.ts` | Status bar display (Idle/Recording/Transcribing/Processing with character counter) |
