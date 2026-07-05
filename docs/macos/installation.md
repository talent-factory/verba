# Installation

!!! warning "Public Beta"
    There is no packaged `.dmg` yet. The macOS app is installed by building it from source.

## Prerequisites

- **Rust toolchain** and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for macOS (Xcode Command Line Tools, etc.)
- **Node.js** (for the npm workspace and the Vite frontend)
- **ffmpeg** is *not* required for the macOS app — it captures audio natively via `cpal`. It's only needed if you also plan to use the VS Code extension; see [Prerequisites](../getting-started/prerequisites.md).

## Build and Run

Clone the repository and run the app through its `just` recipe:

```bash
git clone https://github.com/talent-factory/verba.git
cd verba
npm install
just macos-dev   # compiles @verba/core, starts vite, launches the Tauri app
```

`just macos-dev` depends on the `compile-core` recipe, so it always compiles `@verba/core` to `dist/` before starting Vite and launching Tauri — the macOS app imports `@verba/core`'s built output, not its TypeScript source, so skipping this step leaves it running against a stale build.

The first run will ask for your Deepgram and Anthropic API keys (stored in the system Keychain) and will prompt for Microphone and Accessibility permissions — see [Permissions](permissions.md).

## Next Steps

- [Usage](usage.md) — hotkey, tray menu, and HUD
- [Configuration](configuration.md) — `~/.config/verba/config.json`
