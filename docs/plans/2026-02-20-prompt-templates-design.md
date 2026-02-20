# TF-248: Konfigurierbare Prompt-Templates – Design

## Ziel

Flexibles Template-System, das verschiedene Diktat-Modi erlaubt. User waehlt per Quick-Pick ein Template vor der Aufnahme. Der Claude-Prompt wird entsprechend angepasst.

## Entscheidungen

- **Zeitpunkt der Wahl:** Vor der Aufnahme (Quick-Pick → Aufnahme → Stop → Ergebnis)
- **Memory:** Zuletzt gewaehltes Template wird gemerkt (vorselektiert im Quick-Pick)
- **Sprache:** Sprachunabhaengig — Prompts instruieren Claude, die Sprache des Inputs beizubehalten
- **Architektur:** Ein Claude-Call mit kombiniertem Prompt (Bereinigung + Formatierung)

## Workflow

1. User drueckt `Cmd+Shift+D`
2. Quick-Pick zeigt alle Templates (zuletzt gewaehltes vorselektiert)
3. User waehlt Template → Aufnahme startet
4. User drueckt `Cmd+Shift+D` erneut → Stop, Transkription, Cleanup mit Template-Prompt, Insert

## Template-Datenstruktur

In `settings.json` unter `verba.templates`:

```jsonc
"verba.templates": [
  {
    "name": "Freitext",
    "prompt": "Clean up the transcript: remove filler words, smooth broken sentences. Keep the original language. Return only the cleaned text."
  },
  {
    "name": "Commit Message",
    "prompt": "Convert this transcript into a Git commit message following Conventional Commits format. First line: type(scope): description. Keep the original language. Return only the commit message."
  },
  {
    "name": "JavaDoc",
    "prompt": "Convert this transcript into a JavaDoc comment (/** ... */). Structure with @param, @return, @throws as appropriate. Keep the original language. Return only the JavaDoc comment."
  },
  {
    "name": "Markdown",
    "prompt": "Convert this transcript into well-structured Markdown. Use headings, lists, and emphasis as appropriate. Keep the original language. Return only the Markdown text."
  },
  {
    "name": "E-Mail",
    "prompt": "Convert this transcript into a professional email with greeting and closing. Keep the original language and tone. Return only the email text."
  }
]
```

## Architektur-Aenderungen

### CleanupService

- `process(input: string)` → `process(input: string, systemPrompt?: string)`
- Wenn `systemPrompt` uebergeben wird, diesen statt `CLEANUP_SYSTEM_PROMPT` verwenden
- `CLEANUP_SYSTEM_PROMPT` bleibt als Fallback (Abwaertskompatibilitaet)

### DictationPipeline

- `run(input: string)` bekommt optionalen Context: `run(input: string, context?: PipelineContext)`
- `PipelineContext` enthaelt `{ templatePrompt?: string }`
- `ProcessingStage.process(input, context?)` — Context wird durchgereicht

### extension.ts

- Quick-Pick vor Recording-Start anzeigen
- Template-Auswahl aus `verba.templates` Setting lesen
- Letztes Template in `context.workspaceState` speichern
- Gewaehlten Prompt an `pipeline.run()` uebergeben

### package.json

- `verba.templates` Setting registrieren mit Default-Templates (Array von `{name, prompt}`)
- Typ-Validierung via JSON Schema

## Betroffene Dateien

| Datei | Aenderung |
|-------|-----------|
| `package.json` | `verba.templates` Setting mit Defaults |
| `src/pipeline.ts` | `PipelineContext`, `run()` mit Context |
| `src/cleanupService.ts` | `process()` mit optionalem Prompt |
| `src/extension.ts` | Quick-Pick, Template-Auswahl, Memory |
| `src/test/unit/cleanupService.test.ts` | Tests fuer dynamischen Prompt |
| `src/test/unit/pipeline.test.ts` | Tests fuer Context-Durchreichung |
| Neuer Test | Quick-Pick / Template-Auswahl Logik |
