# Verba

**Verba — developer-grade voice dictation, everywhere you type.**

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/talent-factory.verba)](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/talent-factory.verba)](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)](#)
![macOS app: Beta](https://img.shields.io/badge/macOS%20app-Beta-orange)

Speak instead of type. Verba records your voice, transcribes it with **Deepgram Nova-3**, and refines it with **Claude** — **system-wide across macOS (Beta)** or **deep inside VS Code**. Bring your own keys, keep your data.

![Verba Dictation Workflow](images/screenshots/dictation-workflow.gif)

## Why Verba

- **Bring Your Own Key** — your own Deepgram + Anthropic keys; no subscription.
- **Privacy & data control** — keys in the OS keystore; optional fully offline transcription (whisper.cpp); your audio/text is never routed through us.
- **Developer- & code-aware** — code-aware templates, Claude Code prompt generation, commit messages, JavaDoc, deep VS Code integration.
- **Everywhere** — the same dictation intelligence in your editor *and* across your whole Mac.

## Two Surfaces

### VS Code Extension

Dictation tied to cursor position, active file, and selection. Code-aware templates, terminal insertion, offline transcription.

→ [Install the VS Code extension](vscode/installation.md)

### macOS App (Beta)

System-wide dictation in any app — email, chat, browser, notes. Currently a Public Beta, build-from-source only.

→ [Overview & Status](macos/overview.md)

## New Here?

Not sure which surface fits your workflow? → [Choose Your Surface](getting-started/choose-surface.md)
