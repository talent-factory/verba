# Verba for macOS (Tauri)

System-wide dictation menu-bar app — Phase 1 of the [cross-platform
strategy](../../docs/development/cross-platform-strategy.md). It builds on
[`@verba/core`](../../packages/core) for shared dictation logic (pipeline,
cleanup, adapter contracts); a Rust backend adds the native concerns (global
hotkey, mic capture, Accessibility paste, keychain) plus a native Deepgram
transcription call that replaces `@verba/core`'s SDK-based `DeepgramProvider`,
which cannot run inside Tauri's WebView — see the Status section below.

## Status: Public Beta

- ✅ Menu-bar (tray) accessory app — no Dock icon; global hotkey
  (`Ctrl+Alt+D`) toggles microphone capture.
- ✅ Native mic capture (cpal → WAV, `audio.rs`) and native Deepgram Nova-3
  transcription (`transcribe.rs`) — `@deepgram/sdk` refuses to run inside
  Tauri's WebView, so this replaces `@verba/core`'s SDK-based
  `DeepgramProvider` with a plain REST call.
- ✅ `CleanupService` post-processing (glossary, expansions, templates), then
  paste into the frontmost app (`paste_text`) via clipboard write + synthetic
  ⌘V, with the previous clipboard content restored afterwards.
- ✅ Config system at `~/.config/verba/config.json` (`language`, `glossary`,
  `expansions`, `templates`, `activeTemplate`); tray menu to switch
  transcription provider, cleanup language, and active template, or open/reload
  the config file.
- ✅ HUD window visualizing the working state (idle/recording/transcribing/processing)
  as a non-activating, click-through pill; Accessibility and Microphone
  permission onboarding (System-Settings deep-links) with a fallback to the
  in-window transcript on ungranted permissions or a failed paste.
- 📦 **Public Beta**: no `.dmg`/notarized distribution yet — run from source
  via `just macos-dev` (or `npm run tauri dev` from `apps/macos`).

## Layout

```
apps/macos/
├── src/                     # TypeScript frontend (runs @verba/core)
│   ├── main.ts              # registers the global hotkey
│   ├── controller.ts        # wires @verba/core to the macOS adapters
│   └── adapters/            # TauriNotifier / TauriSecretStore / TauriKeyValueStore
└── src-tauri/               # Rust backend
    ├── src/lib.rs           # tray + plugins (global-shortcut, notification)
    ├── tauri.conf.json      # v2 config (menu-bar app, dmg bundle)
    └── capabilities/        # permission grants
```

## Develop (requires macOS + toolchain)

Prerequisites: Rust (`rustup`), Node, and Xcode command-line tools. The Tauri
CLI is a dev dependency of this package.

```sh
# from the repo root — install workspace deps (links @verba/core)
npm install

# generate app icons once (see src-tauri/icons/README.md)
cd apps/macos && npm run tauri icon ../../images/icon.png

# run the app (builds @verba/core, starts vite, launches Tauri)
npm run tauri dev
```

> **Build not verified in CI yet.** The Rust/Tauri build targets macOS and needs
> the platform toolchain (and, on Linux, webkit2gtk), so it is not exercised in
> the headless environment where this skeleton was authored. The TypeScript
> frontend type-checks against `@verba/core` (`npm run typecheck`); the Rust
> side must be built on a Mac. Validate `tauri.conf.json`/`Cargo.toml` versions
> with `npm run tauri info` before relying on them.

## Next milestones

- **M2** — ✅ shipped: mic capture (Rust) → transcription; Keychain-backed
  `TauriSecretStore`; a key-entry window.
- **M3** — ✅ shipped: native Deepgram transcription (replacing the SDK-based
  provider from M2, which can't run in the WebView) and Accessibility
  permission onboarding (see Status above). ⏳ still open: `CleanupService` +
  paste into the frontmost app (`TextSink` via Accessibility / `CGEvent`).
- **M4/M5** — template picker, settings, glossary/expansions, cost/history;
  signing, notarization, updater.
