# Glossary & Expansions

Two related, but distinct, vocabulary features keep Claude's post-processing predictable: the **glossary** protects terms so they survive transcription and cleanup untouched, and **expansions** turn short abbreviations into their full text. Both are shared `@verba/core` logic — configured once per surface, applied automatically in every template.

## Glossary — protected terms

Product names, technical jargon, and abbreviations often get mangled by speech-to-text ("Kubernetes" → "cooper nettie", "gRPC" → "gee arr pea see"). The glossary protects a list of terms in **two places**:

- **Transcription** — glossary terms are sent to Deepgram as `keyterm` hints, biasing recognition toward the exact spelling. `packages/core/src/deepgramProvider.ts` truncates the list to fit Deepgram's keyterm token budget if it's too long.
- **Cleanup** — the same terms are added to Claude's system prompt (`cleanupService.ts`) as an explicit instruction: preserve these exactly, don't translate or shorten them.

### Configuring the glossary

| Surface | Global | Project/workspace-specific |
|---------|--------|------------------------------|
| VS Code | `verba.glossary` setting in `settings.json` | `.verba-glossary.json` at the workspace root (merged with the global list) |
| macOS | `glossary` array in `~/.config/verba/config.json` | — |

See [VS Code Configuration](../vscode/configuration.md#glossary-dictionary) and [macOS Configuration](../macos/configuration.md) for the exact schema and examples. Keep the combined glossary to roughly 80 terms or fewer — beyond that, Deepgram's keyterm limit means excess terms may be silently dropped.

### Adaptive dictionary generator (VS Code)

Typing every project-specific term into `.verba-glossary.json` by hand doesn't scale. The **`dictation.generateGlossary`** command ("Verba: Generate Glossary") scans your workspace — metadata files, exported source symbols, and headings/bold terms in docs — for likely candidates, then shows them in a multi-select Quick Pick so you can review before anything is written. Accepted terms are merged into `.verba-glossary.json`.

## Expansions — abbreviation shorthand

Expansions let you dictate a short abbreviation and have Claude expand it to the full text during post-processing — useful for names, phrases, or boilerplate you type often. Each entry has the shape:

```json
{ "abbreviation": "brb", "expansion": "be right back" }
```

Unlike the glossary, expansions only affect the **cleanup** stage — Claude is instructed to replace each abbreviation with its expansion in the final text. There is no transcription-side equivalent.

### Configuring expansions

| Surface | Global | Project/workspace-specific |
|---------|--------|------------------------------|
| VS Code | `verba.expansions` setting in `settings.json` | `.verba-expansions.json` at the workspace root |
| macOS | `expansions` array in `~/.config/verba/config.json` | — |

On VS Code, when the same abbreviation is defined both globally and in the workspace file, the **workspace definition wins** — it overrides the global one for that abbreviation, while all other global expansions still apply.

## Interaction with templates

Both the glossary and expansions are appended to the system prompt automatically, for every template — the default cleanup and any [custom template](templates.md) alike. There's nothing to configure per template.
