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
- **TF-263: Adaptive Personal Dictionary** - Done. Workspace scanning for project-specific glossary terms (metadata files, source symbols, doc headings/bold terms). Review via Multi-Select Quick Pick, merge into `.verba-glossary.json`. TypeScript, Java, Python support.
- **TF-265: Multi-Cursor / Selection-aware Dictation** - Done. Selection replacement (dictated text replaces selected text), multi-cursor insertion (text at all cursor positions), selected text as Claude context (`<selection>` tags). "Transform Selection" default template. Selection captured at recording start.
- **TF-262: Text Expansion / Abbreviations** - Done. User-defined abbreviations expanded during Claude post-processing. Global via `verba.expansions` setting, workspace-specific via `.verba-expansions.json`. `setExpansions()` on CleanupService. Workspace expansions override global for same abbreviation.
- **TF-259: File-Type-Aware Templates** - Done. Automatic template selection based on active editor's `languageId`. Optional `fileTypes` array on Template interface (e.g. `["java", "kotlin"]`). `findTemplateForLanguage()` in `templatePicker.ts`. Setting `verba.autoSelectTemplate` (default: `true`). Fallback to last manually chosen template. Built-in defaults: JavaDoc → java/kotlin, Markdown → markdown.
- **TF-264: Dictation History with Full-Text Search** - Done. Persistent dictation history with full-text search via globalState. Browse via Quick Pick (`dictation.showHistory`), search across raw transcript and cleaned text (`dictation.searchHistory`), re-insert or copy past dictations. Three actions: insert at cursor, copy to clipboard, show details. Configurable max entries (`verba.history.maxEntries`, default 500). Privacy: history stays local, never sent to APIs.
- **TF-260: Continuous Dictation** - Done. Longer dictation sessions with automatic pause detection via ffmpeg `silencedetect` filter. Each pause-delimited segment is independently transcribed (Whisper), cleaned (Claude), and inserted. New command `dictation.startContinuous` (`Cmd+Shift+Alt+D`). Configurable silence threshold (`verba.continuous.silenceThreshold`, default 1.5s) and level (`verba.continuous.silenceLevel`, default -30dB). Segments processed via FIFO queue while recording continues. Per-segment undo and history records. Existing single-shot mode unchanged.

## Git Workflow

- **Branching:** `main` is the stable release branch, `develop` is the integration branch
- **PRs always `feature/*` -> `develop`** — never directly to `main`
- **Releases:** `develop` is merged into `main` when a release is due
- **Feature Branches:** `feature/<issue-id>-<description>` (e.g. `feature/tf-250-terminal-dictation`)

## Release Workflow (release-please)

Releases are fully automated via [release-please](https://github.com/googleapis/release-please).

### How it works

1. **Feature branches → `develop`**: Use emoji-prefixed conventional commits via `/commit` (e.g. `✨ feat:`, `🐛 fix:`) — as usual
2. **`develop` → `main`**: **Squash-merge** with a **clean conventional commit message** (no emoji prefix). Example: `feat: API Key Management, Cost Tracking, Security Fixes`
3. release-please detects the merge and creates/updates a **Release PR** (bumps `package.json`, updates `CHANGELOG.md`)
4. Merge the Release PR → tag, GitHub Release, and VSIX artifact are created automatically

### Why squash-merge without emoji?

release-please cannot parse emoji-prefixed conventional commits (`✨ feat:` → not recognized). The squash-merge onto `main` produces a single clean commit that release-please understands. All granular emoji commits remain in the `develop` history.

### Configuration files

- `release-please-config.json` — release type, changelog sections, bootstrap SHA
- `.release-please-manifest.json` — current version tracker (updated automatically by release-please)

## Conventions

- **CHANGELOG.md is always written in English** — all entries, descriptions, and examples must be in English
- Extension name: `verba`
- Command prefix: `dictation.`
- Main command: `dictation.start` (`Cmd+Shift+D` / `Ctrl+Shift+D`)
- Terminal command: `dictation.startFromTerminal` (same shortcut when terminal is focused)
- Audio device command: `dictation.selectAudioDevice` (microphone selection via Quick Pick)
- Template command: `dictation.selectTemplate` (`Cmd+Alt+T` / `Ctrl+Alt+T`) — switch template without recording
- API key management: `dictation.manageApiKeys` — view (masked), update, or delete stored API keys
- Cost overview: `dictation.showCostOverview` — WebView panel with per-model API usage costs (session + total)
- Glossary generator: `dictation.generateGlossary` — scan workspace for project-specific terms, review via Quick Pick, merge into `.verba-glossary.json`
- Dictation history: `dictation.showHistory` — Quick Pick with recent dictations, filter, re-insert or copy
- Search history: `dictation.searchHistory` — full-text search across all dictations (raw transcript + cleaned text)
- Clear history: `dictation.clearHistory` — delete all saved dictations (with confirmation)
- Continuous dictation: `dictation.startContinuous` (`Cmd+Shift+Alt+D` / `Ctrl+Shift+Alt+D`) — start/stop continuous mode with automatic pause segmentation
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
| `cleanupService.ts` | Anthropic Claude API integration (streaming, course correction, voice commands, glossary, text expansions) |
| `pipeline.ts` | Processing stage orchestration |
| `templatePicker.ts` | Quick Pick menu for template selection |
| `insertText.ts` | Text insertion into editor or terminal (multi-cursor, selection replacement) |
| `statusBarManager.ts` | Status bar display (Idle/Recording/Transcribing/Processing with character counter) |
| `costTracker.ts` | API usage cost tracking with persistence via globalState |
| `costOverviewPanel.ts` | WebView panel for cost overview (card layout, session/total toggle) |
| `wavDuration.ts` | WAV file duration calculation from PCM header (for Whisper cost tracking) |
| `glossaryGenerator.ts` | Scans workspace for project-specific glossary terms (metadata, symbols, docs) |
| `historyManager.ts` | Dictation history with globalState persistence and full-text search |
| `historyCommands.ts` | Quick Pick UI for browsing, searching, and acting on history entries |
| `continuousRecorder.ts` | ffmpeg with silencedetect filter, segment extraction, EventEmitter |
