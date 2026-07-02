# Verba for macOS (Tauri)

System-wide dictation menu-bar app — Phase 1 of the [cross-platform
strategy](../../docs/development/cross-platform-strategy.md). It reuses
[`@verba/core`](../../packages/core) unchanged; a Rust backend adds the native
concerns (global hotkey, mic capture, Accessibility paste, keychain).

## Status: M1 skeleton

This milestone is a **skeleton**, not a working dictation app yet:

- ✅ Menu-bar (tray) app with a Quit item; no Dock icon (macOS *accessory*
  activation).
- ✅ Global hotkey (`Alt+Space`) registered from the frontend; on press it shows
  a native notification (the "hello" toast).
- ✅ macOS host adapters implementing the core seams — `TauriNotifier`
  (notification plugin), `TauriSecretStore` (Keychain via Rust commands),
  `TauriKeyValueStore` (JSON file via Rust) — and a `DictationController` that
  constructs `DeepgramProvider` + `CleanupService` from those adapters. This is
  compile-time proof that `@verba/core` is consumable outside VS Code.
- ⏳ **Not yet:** audio capture, transcription, cleanup, and paste are stubbed
  as `invoke()` calls whose Rust commands (`start_capture`, `read_audio_file`,
  `secret_*`, `kv_*`, `paste_text`) land in **M2/M3**.

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
