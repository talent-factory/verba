# Prerequisites

Both surfaces share the same dictation pipeline (Deepgram Nova-3 transcription + Claude post-processing) and the same bring-your-own-key model. Set these up once, then continue to whichever surface you [chose](choose-surface.md).

| Requirement | Purpose | Shared? |
|-------------|---------|---------|
| [ffmpeg](https://ffmpeg.org/) | Microphone recording | VS Code extension only — the macOS app captures audio natively via `cpal` and does not need ffmpeg |
| Deepgram API Key | Nova-3 transcription | Shared by both surfaces |
| Anthropic API Key | Claude post-processing | Shared by both surfaces |

## Installing ffmpeg

Required for the **VS Code extension**. Skip this if you're only installing the macOS app.

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

## API Keys

On first use, Verba prompts for your API keys. On VS Code they're stored in `SecretStorage`; on macOS they're stored in the system Keychain — never in plaintext, and never sent anywhere except Deepgram and Anthropic.

- **Deepgram API Key** — Get one at [console.deepgram.com](https://console.deepgram.com/)
- **Anthropic API Key** — Get one at [console.anthropic.com](https://console.anthropic.com/)

## Offline Alternative

Don't want to send audio to Deepgram at all? The VS Code extension supports fully offline transcription via whisper.cpp, running locally with no network calls. See [Offline Transcription](../vscode/offline.md). This is currently VS Code–only.

## Next Steps

- [VS Code Installation](../vscode/installation.md)
- [macOS Installation](../macos/installation.md)
