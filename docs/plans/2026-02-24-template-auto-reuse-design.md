# Design: Template Auto-Reuse

**Datum:** 2026-02-24
**Ansatz:** A (Separater Command + Auto-Reuse)

## Problem

Bei jedem Diktat muss der User ein Template im Quick Pick auswaehlen, auch wenn er dasselbe Template wie beim letzten Mal verwenden will. Das verlangsamt den Workflow unnoetig.

## Loesung

Das zuletzt verwendete Template wird automatisch wiederverwendet. Der Quick Pick erscheint nur beim allerersten Diktat (wenn noch kein Template gespeichert ist). Zum Wechseln gibt es einen separaten Command.

## Aenderungen

### 1. Neuer Command: `dictation.selectTemplate`

- Title: "Verba: Select Template"
- Keybinding: `Cmd+Shift+T` / `Ctrl+Shift+T`
- Oeffnet Quick Pick mit allen Templates
- Speichert Auswahl in `workspaceState`
- Startet keine Aufnahme — nur Template-Wechsel

### 2. Geaenderter Diktat-Flow

```
Cmd+Shift+D gedrueckt
  -> lastTemplateName in workspaceState vorhanden?
    -> Ja: Template laden, sofort Aufnahme starten (kein Quick Pick)
    -> Nein: Quick Pick erzwingen, dann Aufnahme starten
```

### 3. Status Bar zeigt aktives Template

Idle-Zustand: `$(mic) Verba: Freitext` statt `$(mic) Verba`
Macht den aktiven Template-Zustand transparent.

### 4. Betroffene Dateien

| Datei | Aenderung |
|-------|-----------|
| `package.json` | Neuer Command + Keybinding |
| `extension.ts` | handleDictation Flow aendern, neuer selectTemplate Command |
| `statusBarManager.ts` | Template-Name im Idle-Zustand anzeigen |
| `templatePicker.ts` | Keine Aenderung |
