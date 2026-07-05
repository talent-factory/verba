# Architecture

Verba is a monorepo: one shared dictation core, consumed by two independent
host applications. `@verba/core` (`packages/core`) holds the platform-agnostic
pipeline — recording orchestration contracts, Claude post-processing
(`CleanupService`), the config schema, and the adapter interfaces that let the
same logic run inside very different runtimes. The two hosts are the VS Code
extension (repo root, the shipped flagship) and the macOS app (`apps/macos`, a
Tauri menu-bar app, **Public Beta**, build-from-source only).

## Monorepo layout

npm workspaces (`workspaces: ["packages/*", "apps/*"]` in the root
`package.json`) tie the three packages together:

| Path | Package | Purpose |
|------|---------|---------|
| `packages/core` | `@verba/core` | Platform-agnostic dictation logic shared by both hosts: pipeline, `CleanupService`, config schema (`resolveConfig`), adapter contracts, portable Deepgram provider. Compiled to `dist/` (package `main` → `dist/index.js`). |
| repo root | `verba` | The VS Code extension — the shipped flagship. Imports `@verba/core` from `dist/`. |
| `apps/macos` | Tauri app (unpublished) | The macOS app — system-wide menu-bar dictation, **Public Beta**. TypeScript frontend (`src/`) + Rust backend (`src-tauri/`). Imports `@verba/core` from `dist/`. |

```
                    packages/core (@verba/core)
              pipeline · CleanupService · config schema
                              │  compiled to dist/
              ┌───────────────┴────────────────┐
              │                                 │
   repo root — VS Code host           apps/macos — macOS host (Beta)
```

### Hosts import `dist/`, not `src/`

Both hosts depend on `@verba/core`'s **compiled output**, not its source: the
package's `main` field points at `dist/index.js`. After changing anything
under `packages/core/src/**`, the core must be rebuilt with
`npm run compile:core` before either host picks up the change.

- `just compile` and `just macos-dev` (and the other `just macos-*` recipes)
  do this automatically — they depend on the `compile-core` recipe.
- A direct `npm run tauri dev` from `apps/macos` does **not** rebuild core. A
  stale `dist/` typically shows up as a silently dead feature — e.g. the
  macOS global hotkey stops responding with no error or notification — because
  the host is still running against yesterday's compiled core.

When in doubt, prefer the `just` recipes over calling `npm` scripts directly
inside a host package; they encode this dependency.

## VS Code host

The VS Code extension is the original product and remains the most complete
surface — it has the full pipeline including offline transcription, semantic
context search, and dictation history.

```
Microphone --> ffmpeg (WAV) --> Deepgram API    --> Claude API --> Editor/Terminal
                            \-> whisper.cpp CLI /   (Template)
```

1. **Recording** — ffmpeg captures audio from the microphone as a WAV file.
2. **Transcription** — the WAV file goes to Deepgram Nova-3 (cloud) or, if
   configured, a local whisper.cpp process — which returns raw text.
3. **Post-processing** — the transcript is sent to Claude with the active
   template's prompt. Context-aware templates additionally pull in code
   snippets from semantic search over the workspace.
4. **Insertion** — the processed text is inserted at the cursor position in
   the editor, or pasted into the terminal.

| Module | Responsibility |
|--------|---------------|
| `extension.ts` | Extension entry point, command registration, activation |
| `recorder.ts` | ffmpeg child process for audio recording (macOS/Linux/Windows) |
| `transcriptionService.ts` | Thin orchestrator selecting between `core/deepgramProvider.ts` and `localWhisperProvider.ts` |
| `localWhisperProvider.ts` | Desktop-only offline transcription via whisper.cpp CLI |
| `core/adapters.ts` | Platform-agnostic adapter interfaces (`SecretStore`, `Notifier`, `KeyValueStore`, `AudioBytesReader`, forward-looking `AudioCapture`/`TextSink`/`ConfigProvider`) for the `@verba/core` boundary |
| `core/cleanupService.ts` | Anthropic Claude API integration (streaming, course correction, voice commands, glossary, text expansions) |
| `core/deepgramProvider.ts` | Portable Deepgram Nova-3 cloud transcription (audio bytes and API-key prompt injected) |
| `core/transcription.ts` | Shared transcription contracts (`TranscriptionBackend`, `TranscriptionResult`) and transcript validation |
| `core/pipeline.ts` | Processing stage orchestration |
| `templatePicker.ts` | Quick Pick menu for template selection with auto-reuse |
| `insertText.ts` | Text insertion into editor or terminal (multi-cursor, selection replacement) |
| `statusBarManager.ts` | Status bar display (Idle/Recording/Transcribing/Processing with character counter) |
| `costTracker.ts` | API usage cost tracking with persistence via globalState |
| `costOverviewPanel.ts` | WebView panel for cost overview (card layout, session/total toggle) |
| `wavDuration.ts` | WAV file duration calculation from PCM header (for Deepgram cost tracking) |
| `glossaryGenerator.ts` | Scans workspace for project-specific glossary terms (metadata, symbols, docs) |
| `historyManager.ts` | Dictation history with globalState persistence and full-text search |
| `historyCommands.ts` | Quick Pick UI for browsing, searching, and acting on history entries |
| `continuousRecorder.ts` | Deepgram WebSocket streaming, ffmpeg audio capture, EventEmitter |
| `undoManager.ts` | Single-level undo for dictation insertions (editor + terminal) |
| `contextProvider.ts` | Unified context search abstraction |
| `grepaiProvider.ts` | grepai CLI wrapper for semantic code search |
| `embeddingService.ts` | OpenAI text-embedding-3-small for local embeddings |
| `indexer.ts` | File chunking and incremental index updates |
| `vectorStore.ts` | In-memory vector store with cosine similarity search |

### Context-aware pipeline

For context-aware templates, the pipeline includes an additional step before
post-processing:

```
Transcript → Context Search → Claude API (transcript + code snippets) → Result
```

The context search uses one of two providers:

- **grepai** — external CLI tool that provides semantic search over the codebase.
- **OpenAI Embeddings** — local vector store built from chunked project files, queried via cosine similarity.

### Transcription provider

Verba uses **Deepgram Nova-3** for cloud transcription (both single-shot and
continuous mode). This replaced OpenAI Whisper after systematic evaluation of
7 providers — Whisper's hallucination problem on short audio segments made it
unreliable for continuous dictation. Deepgram was chosen for its built-in VAD,
WebSocket streaming, lower cost ($0.0043/min vs $0.006/min), and minimal
hallucinations.

Local offline transcription via **whisper.cpp** remains available as an
alternative on the VS Code host.

For the full evaluation and decision rationale, see
[ADR: Deepgram Migration](adr-deepgram-migration.md).

### Cross-platform audio

The `recorder.ts` module handles platform differences:

| Platform | Audio Framework | Device Listing |
|----------|----------------|---------------|
| macOS | AVFoundation | `ffmpeg -f avfoundation -list_devices` |
| Linux | PulseAudio | `pactl list sources` |
| Windows | DirectShow | `ffmpeg -f dshow -list_devices` + PowerShell fallback |

## macOS host (Beta)

The macOS app is a Tauri menu-bar app that reuses `@verba/core`'s pipeline and
`CleanupService` for a system-wide dictation experience — a global hotkey
dictates into whatever app currently has focus, not just VS Code. It is a
**Public Beta**: no signed/notarized distributable yet, so it runs from
source via `just macos-dev`.

```
Microphone --> cpal (WAV) --> native Deepgram (Rust REST) --> Claude API (Template) --> Accessibility paste
```

Transcription on this host is a native Rust REST call rather than
`@verba/core`'s SDK-based Deepgram provider, because `@deepgram/sdk`'s
`AbstractRestClient` refuses to run inside Tauri's WebView.

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
| `apps/macos/src-tauri/src/transcribe.rs` | Native Deepgram REST transcription call (Rust), replacing the SDK-based provider that cannot run in the WebView |
| `apps/macos/src-tauri/src/paste.rs` | Accessibility permission check and `paste_text`: clipboard write, synthetic ⌘V, previous-clipboard restore |
| `apps/macos/src-tauri/src/audio.rs` | Native microphone capture via `cpal`, written to WAV on a dedicated capture thread |
| `apps/macos/src-tauri/src/hud.rs` | Floating, non-activating HUD window (show/hide/position owned by Rust so it never steals focus) |
| `apps/macos/src-tauri/src/lib.rs` | App entry point: registers plugins, tray, and Tauri commands |

For build milestones, permission/entitlement details, and the full status of
each macOS feature slice, see [macOS App Internals](macos-internals.md).
