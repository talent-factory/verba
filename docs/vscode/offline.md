# Offline Transcription

By default, Verba sends recorded audio to the Deepgram Nova-3 API for transcription. As an alternative, the VS Code extension can transcribe entirely on-device via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — no audio ever leaves your machine, and there's no per-minute API cost.

!!! note "Platform support"
    Offline transcription currently supports **macOS**. Linux and Windows support is planned for a future release.

## When to Use It

- **Privacy** — sensitive dictation (credentials, proprietary code, confidential notes) never crosses the network.
- **Zero cost** — no Deepgram usage charges; only your one-time model download.
- **Offline environments** — works without an internet connection once a model is downloaded, though Claude post-processing still requires network access to the Anthropic API.

## Setup

1. Install whisper.cpp:

    ```bash
    brew install whisper-cpp
    ```

2. Download a model with the command **Verba: Download Whisper Model** (`dictation.downloadModel`). Models are fetched from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp) and stored in VS Code's global storage, shared across all workspaces.

3. Switch the transcription provider in `settings.json`:

    ```json
    {
      "verba.transcription.provider": "local",
      "verba.transcription.localModel": "base"
    }
    ```

## Available Models

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `tiny` | ~75 MB | Fastest | Lower accuracy |
| `base` | ~148 MB | Fast | Good balance |
| `small` | ~488 MB | Moderate | Better accuracy |
| `medium` | ~1.5 GB | Slow | High accuracy |
| `large-v3-turbo` | ~1.6 GB | Slowest | Best accuracy |

!!! tip
    Start with `base`. If accuracy is insufficient, upgrade to `small` or `medium`. `large-v3-turbo` gives the best quality but needs the most disk space and processing time.

## How It Works

`TranscriptionService` uses a strategy pattern: `setProvider('deepgram' | 'local')` selects the active backend, and `process()` delegates to it. The cloud path goes through `core/deepgramProvider.ts`; the local path goes through `localWhisperProvider.ts`, which shells out to the `whisper-cli` binary and parses its output. Both implement the same `TranscriptionBackend` contract, so the rest of the pipeline — Claude post-processing, glossary, voice commands, course correction — is identical regardless of which provider transcribed the audio.

## Related Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `verba.transcription.provider` | `"deepgram"` | `"deepgram"` (cloud API) or `"local"` (whisper.cpp) |
| `verba.transcription.localModel` | `"base"` | `tiny`, `base`, `small`, `medium`, or `large-v3-turbo` |

See [Configuration](configuration.md) for the full settings reference.
