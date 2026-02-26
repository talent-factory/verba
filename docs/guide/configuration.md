# Configuration

All Verba settings are configured in VS Code's `settings.json`.

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `verba.audioDevice` | String | `""` | Audio input device name. Leave empty for system default. |
| `verba.templates` | Array | 8 built-in templates | Prompt templates for post-processing. See [Templates](templates.md). |
| `verba.terminal.executeCommand` | Boolean | `false` | If `true`, sends Enter after inserting text into the terminal. |
| `verba.glossary` | Array | `[]` | Terms preserved during transcription and cleanup (limit: ~80 terms). |
| `verba.transcription.provider` | String | `"openai"` | Transcription provider: `openai` (API) or `local` (whisper.cpp). |
| `verba.transcription.localModel` | String | `"base"` | Whisper model for local transcription: `tiny`, `base`, `small`, `medium`, `large-v3-turbo`. |
| `verba.contextSearch.provider` | String | `"auto"` | Context search provider: `auto`, `grepai`, or `openai`. |
| `verba.contextSearch.maxResults` | Number | `5` | Number of context snippets per dictation (1-20). |

## Audio Device

By default, Verba uses the system default microphone. To select a specific device:

- Run the command **Verba: Select Audio Device** — a Quick Pick dialog lists all available devices.
- Or set `verba.audioDevice` manually in `settings.json`:

```json
{
  "verba.audioDevice": "MacBook Pro Microphone"
}
```

!!! tip
    On Windows, you can list available devices by running `ffmpeg -list_devices true -f dshow -i dummy` in a terminal.

## Glossary / Dictionary

Define terms (product names, technical jargon, abbreviations) that must be preserved exactly during transcription and cleanup. Glossary terms are sent as hints to Whisper and as protection instructions to Claude.

**Global terms** are configured in `settings.json`:

```json
{
  "verba.glossary": ["Kubernetes", "Visual Studio Code", "PostgreSQL", "gRPC"]
}
```

**Project-specific terms** are defined in a `.verba-glossary.json` file at your workspace root:

```json
["Verba", "CleanupService", "TranscriptionService", "ffmpeg"]
```

Both sources are merged automatically. For best results, keep the combined glossary under ~80 terms (~224 Whisper prompt tokens). If this limit is exceeded, a warning is shown and excess terms may be ignored by Whisper.

!!! tip
    Place `.verba-glossary.json` under version control so that all team members share the same glossary. Changes to the file are picked up automatically.

## Offline Transcription (whisper.cpp)

By default, Verba uses the OpenAI Whisper API for transcription. You can switch to local, offline transcription via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) for full privacy and zero API costs.

### Setup

1. Install whisper.cpp: `brew install whisper-cpp`
2. Download a model: Run **Verba: Download Whisper Model** command
3. Switch the provider:

```json
{
  "verba.transcription.provider": "local",
  "verba.transcription.localModel": "base"
}
```

### Available Models

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `tiny` | ~75 MB | Fastest | Lower accuracy |
| `base` | ~148 MB | Fast | Good balance |
| `small` | ~488 MB | Moderate | Better accuracy |
| `medium` | ~1.5 GB | Slow | High accuracy |
| `large-v3-turbo` | ~1.6 GB | Slowest | Best accuracy |

Models are downloaded to VS Code's global storage and shared across all workspaces.

!!! tip
    Start with the `base` model. If accuracy is insufficient, upgrade to `small` or `medium`. The `large-v3-turbo` model provides the best quality but requires significant disk space and processing time.

!!! note
    Offline transcription currently supports macOS. Linux and Windows support is planned for a future release.

## Context Search Provider

For [context-aware templates](templates.md#context-aware-templates), Verba needs a search provider:

| Provider | Setup | Speed |
|----------|-------|-------|
| `grepai` | Install [grepai](https://yoanbernabeu.github.io/grepai/), run `grepai init` | Fast |
| `openai` | Run **Verba: Index Project** command | Moderate |
| `auto` (default) | Uses grepai if installed, otherwise OpenAI Embeddings | — |

```json
{
  "verba.contextSearch.provider": "auto",
  "verba.contextSearch.maxResults": 5
}
```
