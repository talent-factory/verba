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

The **orchestration mostly runs in the TS frontend** via `@verba/core`, but not
every SDK call can: `@deepgram/sdk`'s REST client throws unconditionally inside
Tauri's WebView (see the M3 milestone below), so Deepgram transcription
happens as a native Rust HTTP call (`transcribe.rs`) instead, behind a thin
`DeepgramTauriProvider` that satisfies `@verba/core`'s `TranscriptionBackend`
contract. Whether the Anthropic SDK (used by `CleanupService`) has the same
restriction is unverified — that lands with M3's `CleanupService` wiring. The
**Rust backend owns everything the web layer categorically cannot do**: global
input, native capture, and system paste. They talk over Tauri's `invoke`/event
IPC.

### Adapter implementations (the Phase 0 seams, realized for macOS)

| Core adapter | macOS implementation |
|--------------|----------------------|
| `AudioCapture` | Rust command records the mic (cpal, or an ffmpeg sidecar to reuse existing device logic) → returns a WAV temp-file path. (`AudioBytesReader` is no longer used by this app — `DeepgramTauriProvider` reads the WAV file directly in Rust rather than shipping bytes to the TS frontend; see the M3 milestone.) |
| `SecretStore` | Rust keychain access (`security-framework`), exposed via `invoke` |
| `KeyValueStore` | JSON file in the app's config dir (`tauri::api::path`) |
| `Notifier` | `tauri-plugin-notification` (native toasts) |
| `TextSink` | Rust: set pasteboard + synthesize ⌘V via `CGEvent`, or AX `kAXValueAttribute` insertion; clipboard-only fallback |

### End-to-end flow

1. User presses the global hotkey (e.g. `Ctrl+Alt+D`) → Rust emits `hotkey` event.
2. Frontend starts capture (`invoke('start_capture')`); tray icon shows recording.
3. Second press stops → Rust returns WAV bytes.
4. Frontend calls `DeepgramTauriProvider.transcribe()`, which invokes the
   native Rust `deepgram_transcribe` command (not `@verba/core`'s
   `DeepgramProvider` — see M3) → (once wired) `CleanupService` (template).
5. Frontend calls `invoke('paste_text', { text })` → Rust pastes into the
   frontmost app.

---

## 3. macOS system integration

- **Global hotkey:** `tauri-plugin-global-shortcut`. User-configurable; default
  chosen to avoid clashes (e.g. `Ctrl+Alt+D`).
- **Menu-bar (tray):** status item with Idle/Recording state, template picker,
  settings, quit. No dock icon (`LSUIElement`).
- **Permissions / entitlements:**
  - **Microphone** — `NSMicrophoneUsageDescription`, `com.apple.security.device.audio-input`.
  - **Accessibility** — required to synthesize paste into other apps; user grants
    it in System Settings → Privacy & Security → Accessibility. Detected via
    `AXIsProcessTrusted()` (M3); the app deep-links to the Accessibility pane
    (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`)
    when ungranted rather than just instructing the user verbally.
- **Distribution:** Developer ID signing + notarization for direct download.
  Mac App Store is a poor fit — its sandbox forbids the global input injection
  that `TextSink` relies on. **Recommendation: direct distribution** (DMG +
  Sparkle-style updates or Tauri updater).

---

## 4. What carries over vs. what's new

| Reused from `@verba/core` (unchanged) | New in `apps/macos` |
|---------------------------------------|---------------------|
| Pipeline, cleanup, prompt engineering | Rust backend (hotkey, capture, paste, keychain) |
| Transcription contracts (`TranscriptionBackend`), keyterm truncation, API-key resolution | macOS adapter implementations, native Deepgram transcription (`transcribe.rs`, replacing the `DeepgramProvider` SDK call — see M3) |
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
   global hotkey (`Ctrl+Alt+D`) → notification toast, and macOS host adapters
   (`TauriNotifier`/`TauriSecretStore`/`TauriKeyValueStore`) + a
   `DictationController` that constructs `@verba/core` services (frontend
   type-checks against the package). No audio yet. The Rust/Tauri build targets
   macOS and is not exercised in CI — see `apps/macos/README.md`.
3. **M2 — Capture + transcription.** ✅ Implemented and manually verified —
   hotkey toggles mic capture (Rust `start_capture`/`stop_capture`, cpal →
   WAV); on stop the recording is transcribed and shown in the window.
   Keychain-backed secrets (`keyring`), JSON key-value store, and a window
   API-key prompt. Transcription no longer goes through `@verba/core`'s
   SDK-based `DeepgramProvider` — see the M3 entry below for why and what
   replaced it.
4. **M3 — Cleanup + paste.** ⏳ In progress — the onboarding-UI slice
   (Accessibility permission check + System-Settings deep-link) is done and
   manually verified end-to-end; `CleanupService` wiring and the real paste
   mechanism are still planned. `controller.ts`'s `stopAndTranscribe()` checks
   `has_accessibility_permission` after each transcription and shows an
   onboarding message (with a button to open System Settings) when ungranted,
   falling through unconditionally to the existing `showTranscript()` display
   either way.
   - **Rust — `paste.rs`:** `has_accessibility_permission()`
     (`AXIsProcessTrusted()`), `open_accessibility_settings()` (opens
     `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`).
     Both verified working on-device. `paste_text` (the actual paste) is not
     yet implemented — see below.
   - **Bug found during this slice's QA, fixed on the same branch: Deepgram
     transcription via `@deepgram/sdk` cannot run in the macOS app at all.**
     `@deepgram/sdk`'s `AbstractRestClient` constructor throws unconditionally
     in any browser-like environment (Tauri's WebView included) unless a
     `proxy` option is configured — this is a hard guard, not a soft CORS
     limitation a custom `fetch` could work around. Fixed by adding a native
     Rust command (`transcribe.rs::deepgram_transcribe`, using `reqwest`) that
     makes the same REST call directly — no browser, no CORS. The macOS app
     now has its own `DeepgramTauriProvider` (`apps/macos/src/`, implementing
     `@verba/core`'s `TranscriptionBackend`) instead of reusing
     `@verba/core`'s `DeepgramProvider`, mirroring how `localWhisperProvider.ts`
     is already a desktop-only backend that lives outside `@verba/core`. This
     also revealed that M1/M2 had never been manually run end-to-end before —
     both were verified purely by type-checking and (for M2) an unverified
     Rust compile.
   - **Paste mechanism is a spike, not a locked decision:** `paste_text` will
     try AX value insertion into the frontmost app's focused element first (no
     clipboard side-effect); if that app doesn't expose an accessible focused
     text field (terminals, some Electron apps), fall back to save-clipboard →
     set-pasteboard → synthesize ⌘V via `CGEvent` → restore-clipboard.
     **Risk:** the AX-insertion crate (`accessibility-sys` / `core-foundation`
     / hand FFI to ApplicationServices) hasn't been verified to compile yet —
     resolve this spike before committing to it as the primary path.
   - **No capability changes needed** — custom Rust commands don't require
     ACL entries in `capabilities/default.json` (confirmed for both M2's and
     this slice's commands).
   - **Explicitly deferred to M4:** streaming cleanup feedback, template
     picker, glossary/expansions wiring.
5. **M4 — Parity polish.** Template picker, glossary/expansions, cost/history,
   settings UI.
6. **M5 — Signing + notarization + updater.** Shippable DMG.

---

## 6. Open questions

- **Mic capture:** ✅ Resolved — native Rust (cpal), landed in M2.
- **Paste mechanism:** ✅ Resolved as an M3 spike, not a pre-commitment — try AX
  value insertion first (cleaner, no clipboard side-effect), fall back to
  pasteboard + synthetic ⌘V (save/restore) when the frontmost app doesn't
  expose an accessible focused text field. See the M3 milestone entry above
  for the concrete fallback order and the AX-crate risk.
- **Streaming/continuous mode:** ship single-shot first (M2–M4); continuous
  (Deepgram WebSocket) is a later milestone. **Note:** M3 found that
  `@deepgram/sdk`'s REST client refuses to run in a browser context at all
  (see M3 entry) — WebSocket connections aren't subject to CORS the same way,
  but verify the SDK's streaming client doesn't have an equivalent
  browser-environment guard before assuming it'll just work in the WebView.
- **Core packaging:** publish `@verba/core` to a registry, or keep it a private
  in-repo workspace package? Private workspace is enough until a third consumer
  (iOS) appears.
