# Configuration

All Verba settings are configured in VS Code's `settings.json`.

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `verba.audioDevice` | String | `""` | Audio input device name. Leave empty for system default. |
| `verba.templates` | Array | 8 built-in templates | Prompt templates for post-processing. See [Templates](templates.md). |
| `verba.terminal.executeCommand` | Boolean | `false` | If `true`, sends Enter after inserting text into the terminal. |
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

## Context Search Provider

For [context-aware templates](templates.md#context-aware-templates), Verba needs a search provider:

| Provider | Setup | Speed |
|----------|-------|-------|
| `grepai` | Install [grepai](https://grepai.dev), run `grepai init` | Fast |
| `openai` | Run **Verba: Index Project** command | Moderate |
| `auto` (default) | Uses grepai if installed, otherwise OpenAI Embeddings | — |

```json
{
  "verba.contextSearch.provider": "auto",
  "verba.contextSearch.maxResults": 5
}
```
