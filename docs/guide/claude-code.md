# Claude Code Integration

Use Verba's **Claude Code Prompt** template to dictate tasks for Claude Code. Verba transcribes your voice, enriches it with codebase context, and generates an optimized prompt — ready to confirm in your terminal.

## Setup

1. Select the "Claude Code Prompt" template via `Cmd+Alt+T`
2. Set up a context provider for codebase-aware prompts:
    - **Option A (recommended):** Install [grepai](https://yoanbernabeu.github.io/grepai/) and run `grepai init` in your project
    - **Option B:** Run command **Verba: Index Project** to build the OpenAI Embeddings index
3. Ensure `verba.terminal.executeCommand` is `false` (default) — text is pasted without submitting

## Workflow

```
1. Focus your terminal running Claude Code
2. Cmd+Shift+D  →  recording starts
3. Speak your task naturally, e.g.:
   "I want the pipeline to support streaming so that transcribed
    text appears incrementally during post-processing"
4. Cmd+Shift+D  →  recording stops
5. Verba:
   a) Transcribes via Whisper
   b) Searches codebase context (pipeline.ts, cleanupService.ts, ...)
   c) Claude generates an optimized prompt:

      "Implement streaming support in the processing pipeline.
       Modify CleanupService.process() in src/cleanupService.ts
       to use Claude's streaming API. Add a callback parameter
       so that insertText.ts can display text incrementally
       as chunks arrive from the API."

6. Prompt appears in your terminal — review, edit if needed, press Enter
7. Claude Code executes the task
```

The template references files and symbols from your codebase via semantic search. The specificity of the generated prompt depends on the context provider's search results — for best results, mention the area of code you want to modify.

## Tips

- **Be descriptive** — Mention the feature area or module you want to change. The context search uses your words to find relevant code.
- **Review before executing** — Keep `executeCommand: false` so you can review and edit the generated prompt before Claude Code processes it.
- **Index regularly** — If using OpenAI Embeddings, re-run **Verba: Index Project** after significant code changes to keep the index current.
