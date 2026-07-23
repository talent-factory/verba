# Verba — Developer-Grade Voice Dictation, Everywhere You Type

## Project

Verba is a voice-dictation product with **two surfaces on a shared `@verba/core`**:
the VS Code extension (shipped flagship, Marketplace) and the native macOS app
(`apps/macos`, Tauri, **Public Beta**, build-from-source only). Both surfaces
record audio, transcribe it with Deepgram Nova-3, and refine the transcript
with the Claude API.

**Positioning:** Verba — developer-grade voice dictation, everywhere you type.
**Repository:** git@github.com:talent-factory/verba.git
**Linear Project:** https://linear.app/talent-factory/project/verba-the-developers-dictation-extension-8227f12a5e2c/

## Tech Stack

- **Language:** TypeScript (both hosts) + Rust (macOS native backend)
- **Monorepo:** npm workspaces (`packages/*`, `apps/*`) — `packages/core` (`@verba/core`, platform-agnostic dictation logic), repo root (VS Code extension), `apps/macos` (Tauri macOS app, Beta). See "Monorepo Layout" below.
- **VS Code host platform:** VS Code Extension API (Electron/Node.js)
- **macOS host platform:** Tauri v2 (Rust backend + WebView frontend)
- **Transcription:** Deepgram Nova-3 pre-recorded API — `@deepgram/sdk` npm package on VS Code; a native Rust REST call on macOS, because `@deepgram/sdk` cannot run inside Tauri's WebView (see Conventions/Architecture)
- **Post-Processing:** Anthropic Claude API (`@anthropic-ai/sdk` npm package) via `@verba/core`'s `CleanupService`, shared by both hosts
- **Continuous Transcription:** Deepgram Nova-3 WebSocket streaming (`@deepgram/sdk` npm package, VS Code only)
- **API Keys:** Bring-Your-Own-Key — `vscode.SecretStorage` (VS Code) / OS Keychain via the `keyring` crate (macOS)

## USPs

1. **Native Integration — In the Editor and Across the OS** - Deep VS Code integration (cursor position, active editor, file context) *and*, on macOS, a system-wide menu-bar app that pastes cleaned dictation into any frontmost application via a global hotkey.
2. **Developer-Specific Prompt Templates** - Commit messages, JavaDoc, code comments, Markdown, emails. Configurable via `settings.json` (VS Code) or `~/.config/verba/config.json` (macOS).
3. **Bring-Your-Own-Key** - Own Deepgram + Anthropic keys (+ OpenAI for embeddings on VS Code). No subscription costs, full data control.

## Implementation Phases (Linear Issues)

All phases are sub-issues of TF-243 (project overview). All core phases are completed.

### Completed

- **TF-244: Extension Scaffold** - Done. Command `dictation.start` with keyboard shortcut, extension base structure.
- **TF-245: Microphone Recording** - Done. ffmpeg child process for audio recording, status bar feedback, cross-platform (macOS/Linux/Windows).
- **TF-246: Transcription API** - Done. Originally OpenAI Whisper, migrated to Deepgram Nova-3 pre-recorded API (TF-272). API key via SecretStorage.
- **TF-247: Claude Post-Processing** - Done. Anthropic Claude integration, filler word removal, pipeline architecture.
- **TF-248: Configurable Prompt Templates** - Done. Quick Pick menu, 8 default templates (incl. 3 context-aware: Code Comment, Explain Code, Claude Code Prompt), freely extensible via `settings.json`.
- **TF-249: Market Analysis** - Done. Competitive analysis (Wispr Flow, Superwhisper, Willow Voice, VoiceInk, etc.).
- **TF-250: Terminal Support** - Done. Insert dictation into terminal, `verba.terminal.executeCommand` setting.
- **Cross-Platform Audio Recording** - Done. macOS (AVFoundation), Linux (PulseAudio), Windows (DirectShow) with configurable device selection on all platforms (Quick Pick + `verba.audioDevice` setting). Device listing via avfoundation (macOS), pactl (Linux), dshow (Windows). ffmpeg v7 and v8+ format detection, PowerShell fallback on Windows.
- **Streaming Post-Processing** - Done. `processStreaming()` with real-time progress display in the status bar (character counter), AbortController support for cancellation, robust error handling (401/429).
- **Course Correction** - Done. Detection and removal of self-corrections in dictation ("no wait, actually X" → only X). Shared `COURSE_CORRECTION_INSTRUCTION` in default cleanup and template framing.
- **Voice Commands** - Done. Voice-driven formatting commands ("New paragraph", "Period", "Bullet point") via prompt engineering. Language-independent, always active. Shared `VOICE_COMMANDS_INSTRUCTION` in default cleanup and template framing.
- **Glossary/Dictionary** - Done. Protected terms during transcription (Deepgram `keywords` parameter) and cleanup (Claude prompt instruction). Global terms via `verba.glossary` setting, project-specific via `.verba-glossary.json`. `setGlossary()` on CleanupService, `glossary` parameter on TranscriptionService.
- **TF-257: Offline Transcription** - Done. Local transcription via whisper.cpp CLI as alternative to cloud API. Strategy pattern on `TranscriptionService` with `setProvider('deepgram'|'local')`. Model download via `dictation.downloadModel` command (Hugging Face). Settings: `verba.transcription.provider`, `verba.transcription.localModel`. macOS support (Linux/Windows planned).
- **TF-263: Adaptive Personal Dictionary** - Done. Workspace scanning for project-specific glossary terms (metadata files, source symbols, doc headings/bold terms). Review via Multi-Select Quick Pick, merge into `.verba-glossary.json`. TypeScript, Java, Python support.
- **TF-265: Multi-Cursor / Selection-aware Dictation** - Done. Selection replacement (dictated text replaces selected text), multi-cursor insertion (text at all cursor positions), selected text as Claude context (`<selection>` tags). "Transform Selection" default template. Selection captured at recording start.
- **TF-262: Text Expansion / Abbreviations** - Done. User-defined abbreviations expanded during Claude post-processing. Global via `verba.expansions` setting, workspace-specific via `.verba-expansions.json`. `setExpansions()` on CleanupService. Workspace expansions override global for same abbreviation.
- **TF-259: File-Type-Aware Templates** - Done. Automatic template selection based on active editor's `languageId`. Optional `fileTypes` array on Template interface (e.g. `["java", "kotlin"]`). `findTemplateForLanguage()` in `templatePicker.ts`. Setting `verba.autoSelectTemplate` (default: `true`). Fallback to last manually chosen template. Built-in defaults: JavaDoc → java/kotlin, Markdown → markdown.
- **TF-264: Dictation History with Full-Text Search** - Done. Persistent dictation history with full-text search via globalState. Browse via Quick Pick (`dictation.showHistory`), search across raw transcript and cleaned text (`dictation.searchHistory`), re-insert or copy past dictations. Three actions: insert at cursor, copy to clipboard, show details. Configurable max entries (`verba.history.maxEntries`, default 500). Privacy: history stays local, never sent to APIs.
- **TF-260: Continuous Dictation** - Done. Longer dictation sessions with Deepgram Nova-3 WebSocket streaming. ffmpeg captures microphone audio (raw PCM to stdout), piped directly to Deepgram's real-time transcription API. Deepgram's built-in VAD handles pause detection and utterance segmentation — no ffmpeg silencedetect, no segment extraction. Each completed utterance goes through Claude cleanup, then insertion. New command `dictation.startContinuous` (`Cmd+Shift+Alt+D`). Deepgram API key via SecretStorage (Bring-Your-Own-Key). Per-utterance undo and history records.
- **TF-272: Deepgram Consolidation** - Done. Replaced OpenAI Whisper API with Deepgram Nova-3 pre-recorded API for single-shot dictation. Both single-shot and continuous now use Deepgram (shared API key). `openai` npm package retained for embeddings only. Cost reduced from $0.006/min (Whisper) to $0.0043/min (Deepgram).

### macOS App (Tauri, Beta)

Sub-issues of TF-518. A system-wide dictation menu-bar app for macOS, built on
`@verba/core`. **Public Beta** — no signed/notarized distributable yet; runs
from source via `just macos-dev` (or `npm run tauri dev` from `apps/macos`).

- **Tray accessory app** - No Dock icon; lives in the menu bar.
- **Global hotkey** (`Control+Alt+D`) - Toggles microphone capture (`apps/macos/src/main.ts`).
- **Native microphone capture** - `cpal` → WAV on a dedicated capture thread (`src-tauri/src/audio.rs`).
- **Native Deepgram transcription** - Plain Rust REST call (`src-tauri/src/transcribe.rs`). Required because `@deepgram/sdk`'s `AbstractRestClient` refuses to run in any browser-like environment — including Tauri's WebView — so `@verba/core`'s SDK-based `DeepgramProvider` cannot be reused here; see `deepgramTauriProvider.ts`.
- **Accessibility paste + clipboard restore** - `paste_text` (`src-tauri/src/paste.rs`) writes the clipboard, sends a synthetic ⌘V into the frontmost app, then restores the previous clipboard content even if the paste fails.
- **Config system** - JSON file at `~/.config/verba/config.json` (XDG), resolved through `@verba/core`'s shared config schema.
- **Template picker + tray settings** - Tray submenus (`src-tauri/src/menu.rs`) switch the active template, transcription provider, and cleanup/transcription language; each change writes the config file and emits `config:changed` for the frontend to re-apply live.
- **HUD visualization** - Non-activating, click-through pill window showing idle/recording/transcribing/processing state (`src-tauri/src/hud.rs`, `apps/macos/src/visualization/*`).
- **Keychain-backed secrets** - Deepgram/Anthropic API keys stored via the `keyring` crate (`src-tauri/src/secret.rs`), with an env-var override for local development.

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

### Release scope

release-please versions the **VS Code extension only** (`package.json` at the repo root). The macOS app (`apps/macos`) is Public Beta with no distributable build or CI packaging yet — it has no release path and is kept out of the release-please flow entirely.

## Conventions

- **CHANGELOG.md is always written in English** — all entries, descriptions, and examples must be in English
- Extension name: `verba`
- Command prefix: `dictation.`
- Main command: `dictation.start` (`Cmd+Alt+V` / `Ctrl+Alt+V`)
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
- **Stale `@verba/core` dist:** hosts import `@verba/core` from `dist/` (package `main` → `dist/index.js`), not `src/`. After changing `packages/core/src/**`, run `npm run compile:core` — `just macos-*` does this automatically; a direct `npm run tauri dev` does not. A stale `dist/` manifests as a dead macOS hotkey with no notification (see "Monorepo Layout" for the full rule).
- **macOS config schema:** top-level bare keys (`language`, `transcription.language`, `glossary`, `expansions`, `templates`, `activeTemplate`, `audioDevice`) — **no** `verba.` prefix. A VS Code–style `verba.language` key is silently ignored. Templates are all-or-nothing: one invalid entry falls back to the 10 bundled defaults. Config lives at `~/.config/verba/config.json` (XDG).

## Monorepo Layout

npm workspaces (`workspaces: ["packages/*", "apps/*"]` in the root `package.json`):

| Path | Package | Purpose |
|------|---------|---------|
| `packages/core` | `@verba/core` | Platform-agnostic dictation logic shared by both hosts: pipeline, `CleanupService`, config schema (`resolveConfig`), adapter contracts, portable Deepgram provider. Compiled to `dist/` (package `main` → `dist/index.js`). |
| repo root | `verba` | The VS Code extension — the shipped flagship. Imports `@verba/core` from `dist/`. |
| `apps/macos` | (Tauri app, unpublished) | The macOS app — system-wide menu-bar dictation, **Public Beta**. TypeScript frontend (`src/`) + Rust backend (`src-tauri/`). Imports `@verba/core` from `dist/`. |

**Build rule:** "Hosts import `@verba/core` from `dist/` (package `main` → `dist/index.js`), not `src/`. After changing `packages/core/src/**`, run `npm run compile:core` — `just macos-*` does this automatically; a direct `npm run tauri dev` does not." A stale dist manifests as a dead macOS hotkey with no notification.

## Architecture

Monorepo: `packages/core` (`@verba/core`) holds the platform-agnostic dictation logic — pipeline, `CleanupService`, config schema, adapter contracts — compiled to `dist/` and imported by both hosts.

```
                    packages/core (@verba/core)
              pipeline · CleanupService · config schema
                              │  compiled to dist/
              ┌───────────────┴────────────────┐
              │                                 │
   repo root — VS Code host           apps/macos — macOS host (Beta)
```

### VS Code host

```
Microphone --> ffmpeg (WAV) --> Deepgram API    --> Claude API --> Editor/Terminal
                            \-> whisper.cpp CLI /   (Template)
```

| Module | Purpose |
|--------|---------|
| `recorder.ts` | ffmpeg child process for audio recording (macOS/Linux/Windows) |
| `transcriptionService.ts` | Thin orchestrator selecting between `core/deepgramProvider.ts` and `localWhisperProvider.ts` |
| `localWhisperProvider.ts` | Desktop-only offline transcription via whisper.cpp CLI |
| `core/adapters.ts` | Platform-agnostic adapter interfaces (`SecretStore`, `Notifier`, `KeyValueStore`, `AudioBytesReader`, forward-looking `AudioCapture`/`TextSink`/`ConfigProvider`) for the `@verba/core` boundary |
| `core/cleanupService.ts` | Anthropic Claude API integration (streaming, course correction, voice commands, glossary, text expansions) |
| `core/deepgramProvider.ts` | Portable Deepgram Nova-3 cloud transcription (audio bytes and API-key prompt injected) |
| `core/transcription.ts` | Shared transcription contracts (`TranscriptionBackend`, `TranscriptionResult`) and transcript validation |
| `core/pipeline.ts` | Processing stage orchestration |
| `templatePicker.ts` | Quick Pick menu for template selection |
| `insertText.ts` | Text insertion into editor or terminal (multi-cursor, selection replacement) |
| `statusBarManager.ts` | Status bar display (Idle/Recording/Transcribing/Processing with character counter) |
| `costTracker.ts` | API usage cost tracking with persistence via globalState |
| `costOverviewPanel.ts` | WebView panel for cost overview (card layout, session/total toggle) |
| `wavDuration.ts` | WAV file duration calculation from PCM header (for Deepgram cost tracking) |
| `glossaryGenerator.ts` | Scans workspace for project-specific glossary terms (metadata, symbols, docs) |
| `historyManager.ts` | Dictation history with globalState persistence and full-text search |
| `historyCommands.ts` | Quick Pick UI for browsing, searching, and acting on history entries |
| `continuousRecorder.ts` | Deepgram WebSocket streaming, ffmpeg audio capture, EventEmitter |

### macOS host

```
Microphone --> cpal (WAV) --> native Deepgram (Rust REST) --> Claude API (Template) --> Accessibility paste
```

| Module | Purpose |
|--------|---------|
| `apps/macos/src/main.ts` | Registers the global hotkey (`Control+Alt+D`) and dispatches hotkey events to the controller |
| `apps/macos/src/wiring.ts` | Builds the production dependency set (Tauri IPC, Keychain-backed adapters, window UI) and hands it to the controller |
| `apps/macos/src/controller.ts` | Owns the dictation flow (hotkey → capture → transcribe → cleanup → paste) on top of injected host adapters; kept free of `@tauri-apps/api` for testability |
| `apps/macos/src/deepgramTauriProvider.ts` | Calls the native `deepgram_transcribe` Rust command instead of `@deepgram/sdk`, which cannot run inside Tauri's WebView |
| `apps/macos/src/config/verbaConfig.ts` | Reads the config file via Tauri IPC and resolves it through `@verba/core`'s `resolveConfig` |
| `apps/macos/src/visualization/*` | Drives the tray icon/tooltip and HUD window from the current dictation state |
| `apps/macos/src/ui.ts` | Minimal DOM UI for the (normally hidden) main window: transcript display, API key prompt, Accessibility onboarding |
| `apps/macos/src-tauri/src/config.rs` | Reads (`read_config`, for the frontend) and writes (`write_config_key`, for tray-menu changes) `~/.config/verba/config.json` (XDG); parsing/validation happen in `@verba/core`, not here |
| `apps/macos/src-tauri/src/menu.rs` | Tray settings menu (provider, cleanup/transcription language, active template); writes the config file and emits `config:changed` |
| `apps/macos/src-tauri/src/store.rs` | JSON-file key/value store backing the frontend `TauriKeyValueStore` |
| `apps/macos/src-tauri/src/secret.rs` | Keychain-backed secret store (via the `keyring` crate), exposing `secret_get`/`secret_set`/`secret_delete` |
| `apps/macos/src-tauri/src/transcribe.rs` | Native Deepgram REST transcription call (Rust), replacing the SDK-based provider that cannot run in the WebView |
| `apps/macos/src-tauri/src/paste.rs` | Accessibility permission check and `paste_text`: clipboard write, synthetic ⌘V, previous-clipboard restore |
| `apps/macos/src-tauri/src/audio.rs` | Native microphone capture via `cpal`, written to WAV on a dedicated capture thread |
| `apps/macos/src-tauri/src/hud.rs` | Floating, non-activating HUD window (show/hide/position owned by Rust so it never steals focus) |
| `apps/macos/src-tauri/src/lib.rs` | App entry point: registers plugins, tray, and Tauri commands |
