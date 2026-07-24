# Templates

A template is nothing more than a Claude post-processing instruction: a name (shown in the Quick Pick menu on VS Code, or the tray "Vorlage" submenu on macOS) paired with a system prompt that shapes what your transcript is turned into. Templates are a shared `@verba/core` concept — the same 9 defaults, and the same `Template` schema, back both surfaces. What differs is *where* you configure them; see [Two Configuration Locations](#two-configuration-locations) below.

## Template Schema

A template is an object with this shape (`Template` in `packages/core/src/config.ts`):

| Property | Type | Required | Description |
|----------|------|:---:|-------------|
| `name` | String | Yes | Display name shown in the picker/menu |
| `prompt` | String | Yes | System prompt sent to Claude |
| `icon` | String | No | Optional emoji, shown in the macOS tray menu; ignored by VS Code |
| `contextAware` | Boolean | No | If `true`, includes code context from semantic search (VS Code only — inert on macOS) |
| `fileTypes` | String[] | No | Auto-selects this template based on the active file's language (VS Code only — inert on macOS) |

## Built-in Templates

Verba ships with **9** default templates, defined once in `packages/core/src/config/defaultTemplates.json` and used as-is by both surfaces:

| Template | Description | Context-Aware |
|----------|-------------|:---:|
| **Freitext** | Cleans up transcript: removes filler words, smooths sentences, fixes errors | |
| **Commit Message** | Converts transcript to Conventional Commits format | |
| **JavaDoc** | Generates a JavaDoc comment block with `@param`, `@return`, `@throws` | |
| **Markdown** | Structures transcript with headings, lists, and emphasis | |
| **E-Mail** | Formats transcript as a professional email | |
| **Code Comment** | Generates a code comment based on transcript and surrounding code | Yes |
| **Explain Code** | Answers questions about code using transcript and codebase context | Yes |
| **Claude Code Prompt** | Converts transcript into a prompt for Claude Code with file references | Yes |
| **Transform Selection** | Applies a spoken instruction to transform the currently selected text | |

## Selecting a Template

- **VS Code** — on first dictation, Verba shows the Quick Pick menu for template selection. After that, your last template is automatically reused — press `Cmd+Alt+V` to start recording immediately. To switch templates, press `Cmd+Alt+T` (Mac) / `Ctrl+Alt+T` (Windows/Linux); the status bar always shows the currently active template.
- **macOS** — pick the active template from the tray's **Vorlage** submenu. The choice is written back to `activeTemplate` in `~/.config/verba/config.json` and stays active until changed again.

## Context-Aware Templates

Templates with `contextAware: true` trigger a semantic code search before sending the transcript to Claude. Verba searches your codebase for relevant files, classes, and functions, and includes them as context snippets in the prompt. This is a **VS Code–only** feature — `contextAware` is inert on macOS.

This requires a context provider:

- **grepai** (recommended) — Install [grepai](https://yoanbernabeu.github.io/grepai/) and run `grepai init` in your project.
- **OpenAI Embeddings** — Run the command **Verba: Index Project** to build a local index.

Configure the provider in Settings:

```json
{
  "verba.contextSearch.provider": "auto",
  "verba.contextSearch.maxResults": 5
}
```

The `auto` setting uses grepai if installed, otherwise falls back to OpenAI Embeddings.

## Two Configuration Locations

Custom templates replace the 9 built-in defaults **entirely** on both surfaces — this is validated as all-or-nothing by the shared `resolveConfig()` in `packages/core/src/config.ts`: if your array is present, non-empty, and every entry has at least a `name` and a `prompt`, it replaces the defaults; otherwise Verba falls back to all 9 defaults. Copy any defaults you want to keep into your own array.

Where you define that array differs per surface:

- **VS Code** — the `verba.templates` array in `settings.json`. See [VS Code Configuration](../vscode/configuration.md) for the settings reference.
- **macOS** — the `templates` array in `~/.config/verba/config.json`. See [macOS Configuration](../macos/configuration.md#templates) for the schema and a full example.

VS Code example:

```json
{
  "verba.templates": [
    {
      "name": "Free Text",
      "prompt": "Clean up the transcript: remove filler words, smooth broken sentence starts, fix transcription errors. Keep the original language and meaning. Return only the cleaned text."
    },
    {
      "name": "Code Review",
      "prompt": "Convert this transcript into structured code review feedback with bullet points for issues found and suggestions. Keep the original language.",
      "contextAware": true
    }
  ]
}
```

!!! tip "Writing Good Prompts"
    - Be specific about the desired output format
    - Tell Claude to "keep the original language" if you dictate in different languages
    - End with "Return only the [result]" to avoid explanatory text in the output

## Glossary, Expansions, Voice Commands & Course Correction

[Glossary terms and expansions](glossary.md) are automatically included in every template's Claude prompt, and [voice commands and course correction](voice-commands.md) are applied to every template's output — the default cleanup and any custom template alike. None of this needs template-specific configuration.
