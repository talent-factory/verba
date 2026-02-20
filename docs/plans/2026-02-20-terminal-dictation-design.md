# Terminal-Unterstuetzung Design (TF-250)

## Ziel

`dictation.start` soll auch bei fokussiertem Terminal funktionieren. Der diktierte Text wird nach Pipeline-Verarbeitung (Whisper → Claude) ins aktive Terminal eingefuegt.

## Entscheidungen

| Frage | Entscheidung | Begruendung |
|-------|-------------|-------------|
| Ziel bei Terminal-Fokus | Text ins Terminal senden | User will direkt im Terminal diktieren (z.B. Claude CLI) |
| Enter-Verhalten | Konfigurierbar via Setting | Default: kein Enter (User kann vor Abschicken bearbeiten) |
| Ansatz | Smart Insert | Minimal-invasiv, nur insertTextAtCursor() erweitern |
| Editor-Prioritaet | Editor vor Terminal | activeTextEditor ist zuverlaessiger als activeTerminal |

## Architektur

### Aktuelle Logik (insertTextAtCursor)

```
activeTextEditor vorhanden? → editor.edit()
Nein → Fehler
```

### Neue Logik (insertText)

```
activeTextEditor vorhanden? → editor.edit()
activeTerminal vorhanden?   → terminal.sendText(text, executeCommand)
Keines von beiden?          → Fehler
```

### VS Code API

- `vscode.window.activeTerminal` — gibt das aktuell fokussierte Terminal oder `undefined`
- `terminal.sendText(text, addNewline)` — sendet Text ans Terminal; `addNewline=true` fuegt Enter hinzu

### Neues Setting

```json
{
  "verba.terminal.executeCommand": {
    "type": "boolean",
    "default": false,
    "description": "If true, sends Enter after inserting text into the terminal."
  }
}
```

## Geaenderte Dateien

- **`src/extension.ts`** — `insertTextAtCursor()` erweitern um Terminal-Fallback, in `insertText()` umbenennen
- **`package.json`** — Setting `verba.terminal.executeCommand` unter `contributes.configuration` registrieren

## Pipeline

Unveraendert. Die Pipeline-Ausgabe (bereinigter Text) wird an die erweiterte Insert-Funktion uebergeben — ob der Text in einen Editor oder ein Terminal geht, ist transparent fuer die Pipeline.

## Fehlerbehandlung

| Szenario | Verhalten |
|----------|-----------|
| Editor fokussiert | Insert wie bisher |
| Terminal fokussiert | `terminal.sendText()` |
| Keines aktiv | Fehler: "No active editor or terminal" |
| Editor-Insert fehlschlaegt | Fehlermeldung wie bisher |

## Tests

- Unit-Tests fuer die erweiterte Insert-Logik (Editor, Terminal, keines)
- Bestehende Pipeline-Tests bleiben unveraendert
