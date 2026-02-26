# Roadmap

Feature-Ideen priorisiert nach Impact und Aufwand.
Basierend auf Marktanalyse (Feb 2026) gegen Wispr Flow, SuperWhisper, VoiceInk, Willow Voice und VS Code Speech.

## Feature-Backlog

| # | Feature | Impact | Aufwand | Begruendung |
|---|---------|--------|---------|-------------|
| 1 | Glossar/Dictionary | Hoch | Niedrig | Geschuetzte Begriffe bei Transkription + Bereinigung. Kein Konkurrent bietet das. [Design](plans/2026-02-26-glossary-design.md) |
| 2 | Offline-Transkription (whisper.cpp) | Hoch | Hoch | Alle Top-Konkurrenten bieten Offline. Privacy-Argument. Eliminiert API-Kosten fuer Whisper. |
| 3 | Undo Last Dictation | Mittel | Niedrig | Cmd+Z Integration oder eigener Command. Letzten Insert merken, bei Undo entfernen. |
| 4 | App-/Dateityp-aware Templates | Mittel | Mittel | Automatische Template-Auswahl basierend auf Dateityp. Wie VoiceInks "Power Mode". |
| 5 | Continuous Dictation | Mittel | Mittel | Laengere Diktier-Sessions mit Pausen-Erkennung. Alle Konkurrenten unterstuetzen das. |
| 6 | Multi-Language Auto-Detection | Niedrig | Niedrig | Whisper liefert die erkannte Sprache bereits. Template-Prompt dynamisch anpassen. |

## Abgeschlossen

| Feature | Umgesetzt |
|---------|-----------|
| Course Correction | Feb 2026 |
| Voice Commands | Feb 2026 |
