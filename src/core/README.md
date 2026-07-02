# `@verba/core`

Platform-agnostic dictation logic — the future `@verba/core` package boundary.

Code here must run on **any host** (the VS Code extension today; a Tauri macOS
app and a native iOS app later). To keep that promise:

- **No `vscode` import** — host UI/APIs are reached only through the adapter
  interfaces in [`adapters.ts`](./adapters.ts) (`SecretStore`, `Notifier`,
  `KeyValueStore`, `AudioBytesReader`, `AudioCapture`, `TextSink`,
  `ConfigProvider`).
- **No Node built-ins at module scope** (`fs`, `child_process`, `path`, …).
  Anything filesystem- or process-bound is injected via an adapter so
  browser/mobile hosts can supply their own implementation.
- **No relative import that escapes this folder** (`../`). Core depends only on
  other core modules and npm SDKs that work cross-platform
  (`@anthropic-ai/sdk`).

The boundary is currently enforced by convention and code review; a dedicated
build/lint boundary comes when `core/` is promoted to a real workspace package.

## Current members

| Module | Purpose |
|--------|---------|
| `adapters.ts` | Host adapter interfaces (the seams) |
| `pipeline.ts` | Processing-stage orchestration (pure) |
| `cleanupService.ts` | Claude post-processing (streaming, course correction, voice commands, glossary, expansions) |
| `transcription.ts` | Transcription contracts (`TranscriptionBackend`, `TranscriptionResult`) + shared `validateTranscript` |
| `deepgramProvider.ts` | Portable Deepgram Nova-3 cloud transcription (audio bytes and API-key prompt injected) |

## Host-side counterparts (intentionally outside core)

- `localWhisperProvider.ts` — offline whisper.cpp transcription. Depends on
  `fs`/`child_process`, so it stays in the extension and plugs into core via the
  `TranscriptionBackend` contract.
- `transcriptionService.ts` — the orchestrator that picks the active backend and
  injects the host's filesystem reader + API-key prompt into `DeepgramProvider`.
