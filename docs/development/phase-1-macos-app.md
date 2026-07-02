# Phase 1 — System-wide macOS App (Tauri)

> **Status:** Design / Planning
> **Depends on:** Phase 0 (`@verba/core` extraction — done)
> **Goal:** Dictate into *any* macOS application via a menu-bar app with a global
> hotkey, reusing `@verba/core` unchanged.
> See also: [Cross-Platform Strategy](./cross-platform-strategy.md).

This document is the build plan for the first non-VS-Code shell. No app code has
been written yet — this defines the structure so the scaffold can be reviewed
before it lands.

---

## 1. Repository layout — promote `@verba/core` to a package

`@verba/core` is now a real workspace package under `packages/core/` (see
below), so the app can depend on a published contract rather than extension
internals. The layout and migration steps below are kept as a record of how the
promotion was done.

Proposed npm-workspaces layout:

```
verba/
├── package.json                 # root: { "workspaces": ["packages/*", "apps/*"] }
├── packages/
│   └── core/                    # @verba/core
│       ├── package.json
│       ├── tsconfig.json
│       └── src/                 # adapters, pipeline, cleanupService,
│                                # transcription, deepgramProvider
├── apps/
│   └── macos/                   # Tauri app (this phase)
│       ├── package.json
│       ├── src/                 # TS frontend (consumes @verba/core)
│       └── src-tauri/           # Rust backend
└── src/                         # VS Code extension (existing)
    └── … imports from @verba/core instead of ./core/…
```

Migration steps (own PR, mechanical):

1. `git mv src/core packages/core/src`; add `packages/core/package.json`
   (`"name": "@verba/core"`, `"main": "dist/index.js"`, `"types"`) and a
   `tsconfig.json`. Add a barrel `index.ts` re-exporting the public API.
2. Root `package.json` gains `"workspaces"`; extension imports switch from
   `./core/…` to `@verba/core`.
3. esbuild already bundles non-external deps, so `@verba/core` is inlined into
   `dist/extension.js` — no packaging change for the extension.
4. Verify `release-please` still tracks the extension version; the core package
   is versioned independently (or kept `private` initially, unpublished).

**Risk:** touches build + release tooling → do it as a standalone PR with the
full test suite green, separate from app code.

---

## 2. Tauri app architecture

```
┌── apps/macos ─────────────────────────────────────────────────────────────┐
│  TS frontend (WebView)                Rust backend (src-tauri)             │
│  ─────────────────────                ─────────────────────────           │
│  • @verba/core pipeline               • global hotkey (tauri-plugin-       │
│  • DictationController                  global-shortcut)                   │
│  • settings UI                        • menu-bar tray + menu               │
│  • host adapter impls  ◀──IPC──▶      • mic capture → WAV/PCM              │
│    (SecretStore, KeyValueStore,       • paste into frontmost app           │
│     Notifier, AudioCapture,             (Accessibility / CGEvent)          │
│     TextSink)                         • keychain access                    │
└───────────────────────────────────────────────────────────────────────────┘
```

The **orchestration and all API calls run in the TS frontend** via `@verba/core`
(the Deepgram + Anthropic SDKs work in the WebView). The **Rust backend owns
only what the web layer cannot do**: global input, native capture, and system
paste. They talk over Tauri's `invoke`/event IPC.

### Adapter implementations (the Phase 0 seams, realized for macOS)

| Core adapter | macOS implementation |
|--------------|----------------------|
| `AudioBytesReader` / `AudioCapture` | Rust command records the mic (cpal, or an ffmpeg sidecar to reuse existing device logic) → returns WAV bytes / temp path |
| `SecretStore` | Rust keychain access (`security-framework`), exposed via `invoke` |
| `KeyValueStore` | JSON file in the app's config dir (`tauri::api::path`) |
| `Notifier` | `tauri-plugin-notification` (native toasts) |
| `TextSink` | Rust: set pasteboard + synthesize ⌘V via `CGEvent`, or AX `kAXValueAttribute` insertion; clipboard-only fallback |

### End-to-end flow

1. User presses the global hotkey (e.g. `⌥Space`) → Rust emits `hotkey` event.
2. Frontend starts capture (`invoke('start_capture')`); tray icon shows recording.
3. Second press stops → Rust returns WAV bytes.
4. Frontend runs `@verba/core`: `DeepgramProvider` → `CleanupService` (template).
5. Frontend calls `invoke('paste_text', { text })` → Rust pastes into the
   frontmost app.

---

## 3. macOS system integration

- **Global hotkey:** `tauri-plugin-global-shortcut`. User-configurable; default
  chosen to avoid clashes (e.g. `⌥Space`).
- **Menu-bar (tray):** status item with Idle/Recording state, template picker,
  settings, quit. No dock icon (`LSUIElement`).
- **Permissions / entitlements:**
  - **Microphone** — `NSMicrophoneUsageDescription`, `com.apple.security.device.audio-input`.
  - **Accessibility** — required to synthesize paste into other apps; user grants
    it in System Settings → Privacy & Security → Accessibility. App must detect
    and guide the user if not yet granted.
- **Distribution:** Developer ID signing + notarization for direct download.
  Mac App Store is a poor fit — its sandbox forbids the global input injection
  that `TextSink` relies on. **Recommendation: direct distribution** (DMG +
  Sparkle-style updates or Tauri updater).

---

## 4. What carries over vs. what's new

| Reused from `@verba/core` (unchanged) | New in `apps/macos` |
|---------------------------------------|---------------------|
| Pipeline, cleanup, prompt engineering | Rust backend (hotkey, capture, paste, keychain) |
| Deepgram provider, transcription contracts | macOS adapter implementations |
| Glossary, expansions, cost tracking, history logic | Menu-bar UI + settings |
| Course correction, voice commands | Permission onboarding flow |

Templates, glossary, and expansions are the same feature set — only the
`ConfigProvider` source differs (app settings file instead of `settings.json`).

---

## 5. Milestones

1. **M0 — Package promotion.** ✅ Done — `@verba/core` is an npm-workspaces package
   under `packages/core/` that builds independently to `dist/`; the extension
   consumes it via `@verba/core` (bundled by esbuild into `dist/extension.js`).
   Suite green (extension + core).
2. **M1 — Tauri skeleton.** ✅ Scaffolded under `apps/macos/` — tray menu-bar app,
   global hotkey (`Alt+Space`) → notification toast, and macOS host adapters
   (`TauriNotifier`/`TauriSecretStore`/`TauriKeyValueStore`) + a
   `DictationController` that constructs `@verba/core` services (frontend
   type-checks against the package). No audio yet. The Rust/Tauri build targets
   macOS and is not exercised in CI — see `apps/macos/README.md`.
3. **M2 — Capture + transcription.** ✅ Implemented — hotkey toggles mic capture
   (Rust `start_capture`/`stop_capture`, cpal → WAV); on stop the recording is
   transcribed via `DeepgramProvider` and shown in the window. Keychain-backed
   secrets (`keyring`), JSON key-value store, and a window API-key prompt. The
   frontend type-checks; the Rust commands (esp. cpal capture) are authored but
   **not yet compiled** — build on a Mac (`apps/macos/README.md`).
4. **M3 — Cleanup + paste.** `CleanupService` + `TextSink` paste into the
   frontmost app. Accessibility permission onboarding.
5. **M4 — Parity polish.** Template picker, glossary/expansions, cost/history,
   settings UI.
6. **M5 — Signing + notarization + updater.** Shippable DMG.

---

## 6. Open questions

- **Mic capture:** native Rust (cpal) for a dependency-free binary, vs. an
  ffmpeg sidecar to reuse the extension's mature device-selection logic. Leaning
  cpal for M2, revisit if device selection gets hairy.
- **Paste mechanism:** AX value insertion (cleaner, but flaky in some apps) vs.
  pasteboard + synthetic ⌘V (robust, but clobbers the clipboard unless we
  save/restore it). Leaning save/restore + ⌘V.
- **Streaming/continuous mode:** ship single-shot first (M2–M4); continuous
  (Deepgram WebSocket) is a later milestone.
- **Core packaging:** publish `@verba/core` to a registry, or keep it a private
  in-repo workspace package? Private workspace is enough until a third consumer
  (iOS) appears.
