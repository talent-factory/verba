# `@verba/core`

Platform-agnostic dictation logic — an npm-workspaces package with its own
build (`tsc` → `dist/`), consumed by hosts as `@verba/core`.

Code here must run on **any host** (the VS Code extension today; a Tauri macOS
app and a native iOS app later). To keep that promise:

- **No `vscode` import** — host UI/APIs are reached only through the adapter
  interfaces in [`src/adapters.ts`](./src/adapters.ts) (`SecretStore`, `Notifier`,
  `KeyValueStore`, `AudioBytesReader`, `AudioCapture`, `TextSink`,
  `ConfigProvider`).
- **No Node built-ins at module scope** (`fs`, `child_process`, `path`, …).
  Anything filesystem- or process-bound is injected via an adapter so
  browser/mobile hosts can supply their own implementation.
- **No relative import that escapes this folder** (`../`). Core depends only on
  other core modules and npm SDKs that work cross-platform
  (`@anthropic-ai/sdk`).

The boundary is checked by a regression test
([`boundary.test.ts`](./src/test/unit/boundary.test.ts)) that scans the compiled
`dist/` output for `require("vscode")`, `require("fs")`, or
`require("child_process")` and fails `npm run test:core` if it finds one. A
`tsc`-only check isn't enough here: `packages/core` shares the workspace's
hoisted `@types/vscode`/`@types/node`, so a stray `vscode`/`fs` import still
type-checks in isolation — it's the compiled-output scan, not the compiler,
that catches it.

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

## Dev tooling

This package has no `devDependencies` of its own — `typescript`, `mocha`,
`@types/mocha`, and `sinon` are all resolved from the root workspace via npm's
hoisting. That's fine as long as `packages/core` stays `"private": true` and is
only ever consumed through the workspace symlink; it would need its own
`devDependencies` if it were ever published or extracted into a standalone repo.
