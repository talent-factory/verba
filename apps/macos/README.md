# Verba for macOS (Tauri)

System-wide dictation menu-bar app — Phase 1 of the [cross-platform
strategy](../../docs/development/cross-platform-strategy.md). It reuses
[`@verba/core`](../../packages/core) unchanged; a Rust backend adds the native
concerns (global hotkey, mic capture, Accessibility paste, keychain).

## Status: M2 — capture + transcription

- ✅ Menu-bar (tray) app with a Quit item; no Dock icon (macOS *accessory*
  activation).
- ✅ Global hotkey (`Alt+Space`) **toggles microphone capture**; on stop the
  recording is transcribed with `DeepgramProvider` and shown in the window.
- ✅ macOS host adapters implementing the core seams — `TauriNotifier`
  (notification plugin), `TauriSecretStore` (Keychain via `keyring`),
  `TauriKeyValueStore` (JSON file) — plus a window prompt for API keys.
- ✅ Rust commands: `start_capture`/`stop_capture` (cpal → WAV),
  `read_audio_file`, `secret_*`, `kv_*`.
- ✅ `NSMicrophoneUsageDescription` in `src-tauri/Info.plist` — without it,
  macOS silently kills the process on first mic access (TCC), regardless of
  the audio API used.
- ⏳ **Next (M3):** run `CleanupService` on the transcript and paste into the
  frontmost app (`TextSink`) instead of just displaying it.

> The **TypeScript frontend type-checks** against `@verba/core`. The **Rust
> commands are authored but not yet compiled here** (Tauri targets macOS; the
> cpal capture in `src-tauri/src/audio.rs` is the piece most likely to need
> iteration on a Mac). Build with `npm run tauri dev` on macOS.

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

- **M2** — mic capture (Rust) → `DeepgramProvider.transcribe`; Keychain-backed
  `TauriSecretStore`; a key-entry window.
- **M3** — `CleanupService` + paste into the frontmost app (`TextSink` via
  Accessibility / `CGEvent`); Accessibility permission onboarding.
- **M4/M5** — template picker, settings, glossary/expansions, cost/history;
  signing, notarization, updater.
