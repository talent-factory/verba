# Verba

**The Developer's Dictation Extension** — Voice dictation with AI-powered post-processing for VS Code.

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/talent-factory.verba)](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/talent-factory.verba)](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)](#)

Verba records speech via your microphone, transcribes it with **OpenAI Whisper**, and post-processes the transcript with **Claude** — all directly inside VS Code. Filler words are removed, sentences are smoothed, and the result is inserted at your cursor position.

![Verba Dictation Workflow](images/screenshots/dictation-workflow.gif)

## Key Features

- **Dictation in Editor and Terminal** — `Cmd+Shift+D` (Mac) / `Ctrl+Shift+D` (Windows/Linux) starts and stops recording. Text is inserted contextually in the editor or terminal.
- **Prompt Templates** — 8 built-in templates including 3 context-aware ones (Code Comment, Explain Code, Claude Code Prompt). Templates control how Claude post-processes the transcript.
- **Template Auto-Reuse** — Your last template is remembered automatically. Switch anytime with `Cmd+Alt+T`.
- **Fully Configurable** — Templates are defined in `settings.json` and freely extensible.
- **Bring Your Own Key** — Use your own OpenAI and Anthropic API keys. No subscription costs, full data control.
- **Cross-Platform** — Works on macOS, Linux, and Windows with platform-specific audio backends.

## Quick Links

- [Installation](getting-started/installation.md) — Prerequisites and setup
- [Quick Start](getting-started/quickstart.md) — Start dictating in under a minute
- [Templates](guide/templates.md) — Built-in and custom templates
- [Claude Code Integration](guide/claude-code.md) — Voice-to-prompt workflow for Claude Code
