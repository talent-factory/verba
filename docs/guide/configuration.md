# Configuration

All Verba settings are configured in VS Code's `settings.json`.

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `verba.audioDevice` | String | `""` | Audio input device name. Leave empty for system default. |
| `verba.templates` | Array | 8 built-in templates | Prompt templates for post-processing. See [Templates](templates.md). |
| `verba.terminal.executeCommand` | Boolean | `false` | If `true`, sends Enter after inserting text into the terminal. |
| `verba.glossary` | Array | `[]` | Terms preserved during transcription and cleanup (limit: ~80 terms). |
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
