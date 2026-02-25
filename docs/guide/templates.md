# Templates

Templates control how Claude post-processes your transcribed speech. Each template has a name (shown in the Quick Pick menu) and a prompt (the instruction sent to Claude).

## Built-in Templates

Verba ships with 8 default templates:

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

## Template Auto-Reuse

On first dictation, Verba shows the Quick Pick menu for template selection. After that, your last template is automatically reused — press `Cmd+Shift+D` to start recording immediately.

To switch templates, press `Cmd+Alt+T` (Mac) / `Ctrl+Alt+T` (Windows/Linux). The status bar always shows the currently active template.

## Context-Aware Templates

Templates with `contextAware: true` trigger a semantic code search before sending the transcript to Claude. Verba searches your codebase for relevant files, classes, and functions, and includes them as context snippets in the prompt.

This requires a context provider:

- **grepai** (recommended) — Install [grepai](https://grepai.dev) and run `grepai init` in your project.
- **OpenAI Embeddings** — Run the command **Verba: Index Project** to build a local index.

Configure the provider in Settings:

```json
{
  "verba.contextSearch.provider": "auto",
  "verba.contextSearch.maxResults": 5
}
```

The `auto` setting uses grepai if installed, otherwise falls back to OpenAI Embeddings.

## Custom Templates

Define custom templates in `settings.json`:

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

### Template Properties

| Property | Type | Required | Description |
|----------|------|:---:|-------------|
| `name` | String | Yes | Display name in the Quick Pick menu |
| `prompt` | String | Yes | System prompt sent to Claude |
| `contextAware` | Boolean | No | If `true`, includes code context from semantic search |

!!! tip "Writing Good Prompts"
    - Be specific about the desired output format
    - Tell Claude to "keep the original language" if you dictate in different languages
    - End with "Return only the [result]" to avoid explanatory text in the output
