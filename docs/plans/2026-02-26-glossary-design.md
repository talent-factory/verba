# Glossar/Dictionary Feature Design

**Date:** 2026-02-26
**Status:** Approved
**Ansatz:** C (Prompt-Injection + Whisper-Prompt-Hint)

## Problem

Claude kuerzt oder uebersetzt Fachbegriffe (z.B. "Visual Studio Code" → "Visual Studio"). Whisper transkribiert unbekannte Begriffe falsch (z.B. "Kubernetes" → "Cooper Netties"). Es gibt keinen Mechanismus, um geschuetzte Begriffe zu definieren.

## Loesung

Benutzer definieren ein Glossar mit Begriffen, die bei Transkription und Bereinigung erhalten bleiben. Die Begriffe werden an zwei Stellen eingesetzt:

1. **Whisper API:** Als `prompt`-Parameter (Transkriptions-Hint)
2. **Claude API:** Als dynamische Prompt-Instruktion (Schutzliste)

## Konfiguration

### Globale Begriffe (User Settings)

```jsonc
// settings.json
"verba.glossary": [
  "Visual Studio Code",
  "Spring Boot",
  "Kubernetes"
]
```

### Projektspezifische Begriffe (Workspace-Datei)

```jsonc
// .verba-glossary.json im Workspace-Root
[
  "TalentFactory",
  "Verba",
  "PipelineContext"
]
```

### Merge-Logik

Beide Listen werden zur Laufzeit zusammengefuehrt (Duplikate entfernt). Workspace-Datei hat Vorrang bei Konflikten.

## Integration

### Whisper (Transkription)

`transcriptionService.ts` erhaelt das gemergte Glossar und uebergibt es als `prompt`-Parameter:

```typescript
const response = await this.client.audio.transcriptions.create({
  model: 'whisper-1',
  file: audioFile,
  prompt: glossaryTerms.join(', ')
});
```

### Claude (Post-Processing)

Dynamische Instruktion, zur Laufzeit gebaut:

```typescript
const GLOSSARY_INSTRUCTION = glossaryTerms.length > 0
  ? `Behalte folgende Begriffe exakt bei (nicht uebersetzen, nicht kuerzen, nicht aendern): ${glossaryTerms.join(', ')}.`
  : '';
```

Eingebunden in `CLEANUP_SYSTEM_PROMPT` und `TEMPLATE_FRAMING`.

### Unterschied zu bestehenden Instruktionen

Course Correction und Voice Commands sind statische Konstanten (Modul-Ebene). Das Glossar ist dynamisch — es aendert sich wenn der User Settings oder Workspace-Datei aendert. Die Instruktion wird in `prepareRequest()` zur Laufzeit gebaut oder der `CleanupService` erhaelt das Glossar als Konstruktor-Parameter.

## Datenfluss

```
Settings + .verba-glossary.json
        | (merge, deduplicate)
   glossaryTerms[]
     |                    |
TranscriptionService   CleanupService
  (prompt-Parameter)   (Prompt-Instruktion)
```

`extension.ts` laedt das Glossar beim Aktivieren und bei Settings-Aenderungen. Reicht das gemergte Array an beide Services weiter.

### Workspace-Datei Handling

- `extension.ts` liest `.verba-glossary.json` beim Start
- `FileSystemWatcher` auf die Datei — bei Aenderung wird das Glossar neu geladen
- Datei existiert nicht → kein Fehler, leeres Array
- Ungueltige JSON-Syntax → Warnung in Output Channel, ignorieren

## Aenderungen pro Modul

| Modul | Aenderung |
|-------|-----------|
| `extension.ts` | Glossar laden, mergen, Watcher registrieren, an Services uebergeben |
| `transcriptionService.ts` | `prompt`-Parameter akzeptieren und an Whisper uebergeben |
| `cleanupService.ts` | Glossar-Begriffe als dynamische Prompt-Instruktion einbauen |
| `package.json` | `verba.glossary` Setting definieren |

## Limiten

- **Whisper-Prompt:** Max. ~224 Tokens (~80 Begriffe). Bei Ueberschreitung wird abgeschnitten und eine Warnung geloggt.
- **Keine Wildcards oder Regex** — nur exakte Strings.

## Was wir NICHT bauen

- Kein UI zum Bearbeiten des Glossars (Settings + JSON-Datei reicht)
- Kein Fuzzy-Matching oder Pre-Processing
- Keine Import/Export-Funktion
- Keine Validierung der Begriffe (alles sind einfache Strings)

## Tests

| Test | Beschreibung |
|------|-------------|
| Glossar-Merge | Globale + Workspace-Begriffe zusammengefuehrt, Duplikate entfernt |
| Leeres Glossar | Kein Glossar → keine Instruktion im Prompt, kein Whisper-Prompt |
| Whisper-Prompt | Glossar-Begriffe werden als `prompt`-Parameter uebergeben |
| Claude Default-Prompt | Glossar-Instruktion erscheint im System-Prompt |
| Claude Template-Prompt | Glossar-Instruktion erscheint im Template-Framing |
| Streaming | Glossar-Instruktion in beiden Streaming-Pfaden |
| Token-Limit | Bei >224 Tokens wird abgeschnitten + Warnung geloggt |
| Fehlende Workspace-Datei | Kein Fehler, leeres Array |
| Ungueltige JSON-Syntax | Warnung, Workspace-Glossar wird ignoriert |

## Dokumentation

- README.md: Feature-Beschreibung + Settings-Tabelle
- CLAUDE.md: Implementierungsphasen + Architektur-Tabelle
- docs/guide/configuration.md: `verba.glossary` Setting + Whisper-Limite
- docs/guide/templates.md: Glossar-Interaktion mit Templates
- CHANGELOG.md: Feature-Eintrag

## Marktanalyse

Kein Konkurrent im VS Code Marketplace bietet ein Glossar/Dictionary-Feature:

| Extension | Post-Processing | Glossar |
|-----------|-----------------|---------|
| VS Code Speech (Microsoft) | Keins | Nein |
| Whisper Assistant | Keins | Nein |
| Inflammation | KI (Code-aware) | Nein |
| Voice Assistant | Nein | Nein |
| **Verba** | **Claude (Templates, Streaming, Course Correction, Voice Commands)** | **Geplant** |
