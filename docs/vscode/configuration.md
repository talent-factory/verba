# Configuration

All Verba settings are configured in VS Code's `settings.json`. Two related concerns — [prompt templates](../concepts/templates.md) and the [glossary/expansions vocabulary](../concepts/glossary.md) — are shared `@verba/core` concepts also used by the macOS app; this page covers only the VS Code–specific `settings.json` schema for them.

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `verba.audioDevice` | String | `""` | Audio input device name. Leave empty for system default. |
| `verba.templates` | Array | 9 built-in templates | Prompt templates for post-processing. See [Templates](../concepts/templates.md). |
| `verba.autoSelectTemplate` | Boolean | `true` | Automatically select a matching template based on the active file's language (e.g. JavaDoc for `.java`). |
| `verba.terminal.executeCommand` | Boolean | `false` | If `true`, sends Enter after inserting text into the terminal. |
| `verba.glossary` | Array | `[]` | Terms preserved during transcription and cleanup (limit: ~80 terms). See [Glossary & Expansions](../concepts/glossary.md). |
| `verba.expansions` | Array | `[]` | Abbreviations automatically expanded during post-processing. See [Glossary & Expansions](../concepts/glossary.md#expansions-abbreviation-shorthand). |
| `verba.language` | String | `"auto"` | Language for post-processing. `auto` uses Deepgram's detected language to hint Claude about the transcript's language. |
| `verba.transcription.provider` | String | `"deepgram"` | Transcription provider: `deepgram` (API) or `local` (whisper.cpp). See [Offline Transcription](offline.md). |
| `verba.transcription.localModel` | String | `"base"` | Whisper model for local transcription: `tiny`, `base`, `small`, `medium`, `large-v3-turbo`. |
| `verba.transcription.language` | String | `"multi"` | Transcription language. `multi` uses Deepgram's multilingual model; a fixed code (e.g. `de`) forces that language. |
| `verba.contextSearch.provider` | String | `"auto"` | Context search provider: `auto`, `grepai`, or `openai`. |
| `verba.contextSearch.maxResults` | Number | `5` | Number of context snippets per dictation (1-20). |
| `verba.history.maxEntries` | Number | `500` | Maximum number of dictation history entries to keep. See [Dictation History](history.md). |

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

## Glossary & Expansions { #glossary-dictionary }

`verba.glossary` and `verba.expansions` are the VS Code–side configuration for two shared vocabulary features — protecting terms so they survive transcription and cleanup untouched, and expanding short abbreviations into full text. Both are documented in full, including the `.verba-glossary.json` / `.verba-expansions.json` workspace-file schema and the `dictation.generateGlossary` command, on [Glossary & Expansions](../concepts/glossary.md).

```json
{
  "verba.glossary": ["Kubernetes", "Visual Studio Code", "PostgreSQL", "gRPC"],
  "verba.expansions": [{ "abbreviation": "brb", "expansion": "be right back" }]
}
```

## Offline Transcription

Switch `verba.transcription.provider` to `"local"` to transcribe entirely on-device via whisper.cpp — no audio leaves your machine, and there's no per-minute API cost. Currently macOS-only. See [Offline Transcription](offline.md) for setup, model choices, and how the strategy pattern behind `TranscriptionService` selects the backend.

## Context Search Provider

For [context-aware templates](../concepts/templates.md#context-aware-templates), Verba needs a search provider:

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
