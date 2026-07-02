# Verba Cross-Platform Strategy

> **Status:** Proposal / Planning
> **Date:** 2026-07-02
> **Decision:** macOS-first (shared core + system-wide macOS app), iOS/iPadOS as a later phase
> **Scope:** Make Verba available beyond VS Code — primary target is the Apple ecosystem (macOS, iPhone, iPad)

---

## 1. Motivation

Today Verba is a **VS Code extension** and can only be used inside VS Code. The
goal is to make the dictation experience **universally available**, with the
Apple ecosystem as the primary target: macOS (daily driver), plus iPhone and
iPad.

A key constraint drives the whole strategy: **VS Code does not run on
iPhone/iPad.** The current product therefore *cannot* run there at all — those
devices require a genuinely native app. On macOS, the bigger opportunity is not
"port the extension" but **system-wide dictation** — dictate into *any*
application, not just VS Code.

---

## 2. Codebase analysis: what is coupled to VS Code today?

The encouraging finding: Verba is already **architecturally well separated**.
The actual value — prompt engineering, cleanup, transcription orchestration —
barely depends on VS Code. Two existing patterns make this possible:

1. Services define their **own `SecretStorage` interface** instead of importing
   `vscode.SecretStorage` directly.
2. `vscode` is only **lazy-loaded** (`require('vscode')`) where unavoidable.

### 2.1 Portable core (already largely decoupled)

| Module | Coupling to VS Code | Portability |
|--------|--------------------|-------------|
| `pipeline.ts` | None (pure TS) | ✅ 100 % reusable |
| `cleanupService.ts` | One lazy `require('vscode')` for a warning; uses `SecretStorage` **interface** | ✅ Nearly complete |
| `transcriptionService.ts` (Deepgram path) | `fs.readFileSync` + `SecretStorage` interface | ✅ with an adapter |
| Prompt engineering (course correction, voice commands, glossary, expansions) | None | ✅ This is the actual IP |
| `costTracker.ts`, `historyManager.ts` (logic) | `globalState` interface | ✅ with an adapter |

### 2.2 Not portable (platform glue — rebuilt per target)

- **`recorder.ts` / `continuousRecorder.ts`** — Node `child_process` + the
  **ffmpeg binary**. Not available on iOS/iPadOS or in the browser. Audio
  capture must be native per platform (AVAudioEngine on Apple, `getUserMedia`
  on the web).
- **`insertText.ts`** — VS Code editor/terminal API. System-wide on macOS or on
  iOS this needs a different output path (Accessibility paste, keyboard
  extension, clipboard).
- **`extension.ts`** — ~61 KB, ~179 `vscode` references: the pure
  orchestration/UI layer.
- Semantic code search (`indexer`, `embeddingService`, `vectorStore`) — only
  meaningful in an editor context; irrelevant for mobile.

### 2.3 Transcription & post-processing on non-Node platforms

Both providers expose plain **REST APIs**:

- **Deepgram Nova-3** — pre-recorded REST + real-time WebSocket. Callable from
  Swift via `URLSession` / `URLSessionWebSocketTask`, no SDK required.
- **Anthropic Claude** — REST API, callable from Swift via `URLSession`.

On mobile there is also an **on-device option**: Apple's `SFSpeechRecognizer`
(Speech framework) or a whisper.cpp build compiled for iOS — attractive for
privacy and cost, mirroring the existing local-whisper provider on desktop.

---

## 3. Target architecture: `@verba/core` + platform shells

The pattern is **one shared logic core, several thin platform shells** that
plug in through adapter interfaces.

```
┌─────────────────────── @verba/core (pure TypeScript) ───────────────────────┐
│  pipeline · cleanupService · transcription(REST) · prompts · glossary ·      │
│  expansions · costTracker · history                                          │
│  Adapter interfaces:  AudioCapture · SecretStore · TextSink · Config         │
└─────────────────────────────────────────────────────────────────────────────┘
        ▲                        ▲                          ▲
   VS Code Ext            macOS menu-bar app          iOS/iPadOS app
 (existing, refactored)   (system-wide, hotkey)      (Swift + keyboard ext.)
```

### 3.1 Adapter interfaces (the seams)

| Interface | Responsibility | VS Code impl | macOS impl | iOS impl |
|-----------|----------------|--------------|------------|----------|
| `AudioCapture` | Produce audio (WAV/PCM) or a live stream | ffmpeg child process | native mic / ffmpeg sidecar | AVAudioEngine |
| `SecretStore` | Store/retrieve API keys | `vscode.SecretStorage` | Keychain | Keychain (+ App Group) |
| `TextSink` | Deliver the final text | editor/terminal edit | Accessibility paste / CGEvent | keyboard extension / pasteboard |
| `Config` | Templates, glossary, language, etc. | `workspace.getConfiguration` | app settings | app settings |

The core already effectively has `SecretStore` (as `SecretStorage`). The work is
to formalize the other three and remove the single lazy `require('vscode')` in
`cleanupService.ts` (replace with an injected `notify` callback).

---

## 4. Roadmap (sorted by ROI)

### Phase 0 — Extract the core (small, low-risk, immediately useful) ✅ done

Carve `@verba/core` out of the extension. Because the services already used
interfaces rather than `vscode`, this was mostly decoupling + relocating:

- ✅ Formalized the adapter interfaces in `packages/core/src/adapters.ts`
  (`SecretStore`, `Notifier`, `KeyValueStore`, `AudioBytesReader`, plus
  forward-looking `AudioCapture`, `TextSink`, `ConfigProvider`).
- ✅ Removed the lazy `require('vscode')` from `cleanupService`, `costTracker`,
  and `historyManager` in favor of an injected `Notifier`.
- ✅ Put audio reads behind an injected `AudioBytesReader` (defaults to `fs` in
  the host) so core never imports `fs`.
- ✅ Relocated the portable modules into `packages/core/src/` (`pipeline`,
  `cleanupService`, `transcription` contracts, `deepgramProvider`) — a
  self-contained boundary: no `vscode`, no Node built-ins, no `../` imports.
- ✅ Split transcription into a portable Deepgram provider (core) and a
  desktop-only whisper.cpp backend (host) behind a shared `TranscriptionBackend`.
- ✅ Promoted `@verba/core` to a real npm-workspaces package under
  `packages/core/`, with its own `package.json`/`tsconfig.json` that builds
  independently (`npm run compile:core`), consumed by the extension via
  `@verba/core` and bundled by esbuild into `dist/extension.js`. The boundary
  is checked by a regression test that scans the compiled output for stray
  `vscode`/`fs`/`child_process` requires.

**Outcome:** cleaner extension, better testability, and the foundation for every
platform that follows. No user-visible change.

### Phase 1 — macOS system-wide (biggest ROI) ⭐ chosen starting point

A **menu-bar app with a global hotkey** that dictates into *any* app — not just
VS Code.

- **Framework:** **Tauri** (decided). A TypeScript/web frontend consumes
  `@verba/core` 1:1, while a Rust backend handles the native concerns (global
  hotkey, microphone capture, Accessibility paste). Chosen over Electron for its
  much smaller bundle, lower memory footprint, and native Rust access to system
  APIs — and because we already have good experience with Tauri from the **HP41C
  project**.
- **Flow:** global hotkey → native mic capture → pipeline → insert text into the
  frontmost app via the Accessibility API / `CGEvent` (paste), with clipboard
  fallback.
- **Reuse:** ~all core logic, all prompt engineering, cost tracking, history.
- **This is the real leap** from "a VS Code tool" to "a dictation tool for the
  whole Mac."

Open design points: microphone permission & entitlements, Accessibility
permission for system-wide paste, code signing / notarization, distribution
(direct download vs. Mac App Store — note App Store sandbox limits on global
input injection).

### Phase 2 — iOS / iPadOS (native app)

TypeScript can no longer run natively in a convenient way. Two honest options:

- **React Native** → maximum reuse of `@verba/core`, but keyboard extensions in
  RN are awkward and memory-constrained.
- **Native Swift/SwiftUI** (one Xcode project for iPhone + iPad) → best UX, App
  Store friendly, optional on-device `SFSpeechRecognizer`. Reuse here is not the
  code but the **prompt contracts and API contracts** (port once, keep in sync).

**Critical iOS constraint to design around early:** a custom keyboard extension
**cannot access the microphone directly**. The standard pattern is: the
container app records (shared via an App Group), and the keyboard only inserts
the finished text. This shapes the entire UX.

---

## 5. Decision & recommendation

- **Chosen path: macOS-first.** Do **Phase 0 + Phase 1** first — the shared core
  plus a system-wide macOS app deliver by far the most value per unit of effort
  and cover the primary daily-use device.
- **iOS/iPadOS (Phase 2)** follows once the core is stable and the adapter/prompt
  contracts have settled, reducing rework.

### Suggested immediate next step

Begin **Phase 0**: extract `@verba/core` from the extension and formalize the
adapter seams. It is low-risk, ships no user-visible change, and unblocks the
macOS app.

---

## 6. Open questions / risks

- **macOS distribution:** direct + notarization vs. Mac App Store (sandbox
  restricts global input injection).
- **iOS transcription:** cloud Deepgram vs. on-device Speech framework/whisper —
  trade-off between accuracy/cost and privacy/offline.
- **Keeping prompt logic in sync** between the TS core and a potential native
  Swift port (single source of truth for prompt strings).
- **API-key handling** across devices (per-device Keychain vs. optional iCloud
  Keychain sync) while preserving the Bring-Your-Own-Key model.
