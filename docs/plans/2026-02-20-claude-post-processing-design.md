# Claude Post-Processing Design (TF-247)

## Ziel

Das rohe Whisper-Transkript durch Claude API bereinigen: Fuellwoerter entfernen, Sprache glaetten, bereinigten Text an Cursor-Position einfuegen.

## Entscheidungen

| Frage | Entscheidung | Begruendung |
|-------|-------------|-------------|
| Toggle | Always-on | Phase 5 Templates bringen spaeter Flexibilitaet |
| Modell | claude-haiku-4-5-20251001 | Schnellstes/guenstigstes Modell, ausreichend fuer Textbereinigung, <5s Latenz-Ziel |
| Sprache | German-first | Optimiert fuer deutsche Fuellwoerter gemaess Linear-Issue |
| API Key | Same pattern wie OpenAI | SecretStorage mit Prompt-on-first-use, konsistente UX |
| Architektur | Mirror TranscriptionService | Selbststaendiger CleanupService, gleiche Patterns, vermeidet premature abstraction |

## Architektur

### Pipeline-Integration

```
pipeline.addStage(new VerbaTranscriptionService(context.secrets));  // Stage 1: Whisper
pipeline.addStage(new VerbaCleanupService(context.secrets));        // Stage 2: Claude
```

Datenfluss: `WAV-Dateipfad` -> Whisper -> `Roh-Transkript` -> Claude -> `Bereinigter Text` -> Editor

### Neue Dateien

- **`src/cleanupService.ts`** — `CleanupService` implementiert `ProcessingStage`. Verwaltet Anthropic API Key, ruft Claude Haiku mit deutschem Cleanup-Prompt auf.
- **`src/test/unit/cleanupService.test.ts`** — Unit-Tests, gleiche Struktur wie `transcriptionService.test.ts`.

### Geaenderte Dateien

- **`src/extension.ts`** — `VerbaCleanupService`-Subklasse (wie `VerbaTranscriptionService`), als zweite Pipeline-Stage verdrahten.
- **`package.json`** — `@anthropic-ai/sdk` Dependency hinzufuegen.

## CleanupService

Folgt dem gleichen Pattern wie `TranscriptionService`:
- Implementiert `ProcessingStage` (input: Roh-Transkript, output: bereinigter Text)
- Eigene `SecretStorage`-Verwaltung fuer Anthropic API Key
- Protected `promptForApiKey()` als Override-Point
- Lazy Client-Caching mit Invalidierung bei 401
- `VerbaCleanupService` in `extension.ts` ueberschreibt `promptForApiKey()` mit `vscode.window.showInputBox`

## Cleanup-Prompt

```
Du erhaeltst ein rohes Sprach-Transkript. Bereinige es:
- Entferne Fuellwoerter (aehm, aeh, halt, eigentlich, sozusagen, quasi, irgendwie, etc.)
- Glaette abgebrochene oder wiederholte Satzanfaenge
- Korrigiere offensichtliche Transkriptionsfehler
- Behalte den exakten Sinn und Stil bei
- Gib NUR den bereinigten Text zurueck, ohne Erklaerungen
```

## Fehlerbehandlung

| Fehler | Verhalten |
|--------|-----------|
| Kein API Key | Prompt-on-first-use via InputBox |
| 401 Unauthorized | Key + Client loeschen, beim naechsten Aufruf neu prompten |
| Rate Limit / Netzwerk | Fehlermeldung mit Details propagieren |
| Leere Antwort | Roh-Transkript unveraendert zurueckgeben (kein Fehler) |

## Abhaengigkeiten

- `@anthropic-ai/sdk` npm Package
- Bestehende `ProcessingStage`-Schnittstelle aus `pipeline.ts`
- `SecretStorage`-Interface aus `transcriptionService.ts` (Pattern kopieren, nicht importieren)
