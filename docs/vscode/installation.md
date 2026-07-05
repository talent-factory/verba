# Installation

## Install the Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba):

```
ext install talent-factory.verba
```

Or search for **"Verba"** in the VS Code Extensions sidebar.

## Prerequisites

Before installing, make sure you have ffmpeg, a Deepgram API key, and an Anthropic API key set up — see [Prerequisites](../getting-started/prerequisites.md) for install snippets and where to get keys.

On first use, Verba prompts for your Deepgram and Anthropic API keys. They are stored securely in VS Code's `SecretStorage` — never in plaintext.

## Managing API Keys

Use the command **Verba: Manage API Keys** (`dictation.manageApiKeys`) at any time to view your stored keys (masked), update them, or delete them — no need to reinstall or wait for the first-use prompt.

## Platform-Specific Notes

| Platform | Audio Backend | Microphone Selection |
|----------|--------------|---------------------|
| macOS | AVFoundation | Configurable via `verba.audioDevice` or Quick Pick |
| Linux | PulseAudio | Configurable via `verba.audioDevice` or Quick Pick |
| Windows | DirectShow | Configurable via `verba.audioDevice` or Quick Pick |

!!! note "Linux"
    PulseAudio must be running (default on Ubuntu, Fedora, and most desktop distributions).

!!! note "Windows"
    On first use, a Quick Pick dialog lets you select the microphone. Verba detects devices via ffmpeg (v7 and v8+ formats) with a PowerShell fallback.

You can select the microphone anytime with the command **Verba: Select Audio Device** or by setting `verba.audioDevice` in Settings. Without configuration, the system default microphone is used.
