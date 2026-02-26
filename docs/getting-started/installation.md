# Installation

## Install the Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba):

```
ext install talent-factory.verba
```

Or search for **"Verba"** in the VS Code Extensions sidebar.

## Prerequisites

Verba requires three things to work:

| Requirement | Purpose |
|-------------|---------|
| [ffmpeg](https://ffmpeg.org/) | Audio recording from your microphone |
| OpenAI API Key | Whisper transcription |
| Anthropic API Key | Claude post-processing |

### Installing ffmpeg

=== "macOS"

    ```bash
    brew install ffmpeg
    ```

=== "Linux (Debian/Ubuntu)"

    ```bash
    sudo apt install ffmpeg
    ```

=== "Linux (Fedora)"

    ```bash
    sudo dnf install ffmpeg
    ```

=== "Windows"

    Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH, or via [Chocolatey](https://chocolatey.org/):

    ```powershell
    choco install ffmpeg
    ```

### API Keys

On first use, Verba prompts for your API keys. They are stored securely in VS Code's `SecretStorage` — never in plaintext.

- **OpenAI API Key** — Get one at [platform.openai.com](https://platform.openai.com/api-keys)
- **Anthropic API Key** — Get one at [console.anthropic.com](https://console.anthropic.com/)

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
