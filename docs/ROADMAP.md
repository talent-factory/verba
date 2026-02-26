# Roadmap

Feature-Ideen priorisiert nach Impact und Aufwand.
Basierend auf Marktanalyse (Feb 2026) gegen Wispr Flow, SuperWhisper, VoiceInk, Willow Voice und VS Code Speech.

## Feature-Backlog

| # | Feature | Impact | Aufwand | Linear | Begruendung |
|---|---------|--------|---------|--------|-------------|
| 1 | Offline-Transkription (whisper.cpp) | Hoch | Hoch | [TF-257](https://linear.app/talent-factory/issue/TF-257) | Alle Top-Konkurrenten bieten Offline. Privacy-Argument. Eliminiert API-Kosten fuer Whisper. |
| 2 | Undo Last Dictation | Mittel | Niedrig | [TF-258](https://linear.app/talent-factory/issue/TF-258) | Cmd+Z Integration oder eigener Command. Letzten Insert merken, bei Undo entfernen. |
| 3 | App-/Dateityp-aware Templates | Mittel | Mittel | [TF-259](https://linear.app/talent-factory/issue/TF-259) | Automatische Template-Auswahl basierend auf Dateityp. Wie VoiceInks "Power Mode". |
| 4 | Continuous Dictation | Mittel | Mittel | [TF-260](https://linear.app/talent-factory/issue/TF-260) | Laengere Diktier-Sessions mit Pausen-Erkennung. Alle Konkurrenten unterstuetzen das. |
| 5 | Multi-Language Auto-Detection | Niedrig | Niedrig | [TF-261](https://linear.app/talent-factory/issue/TF-261) | Whisper liefert die erkannte Sprache bereits. Template-Prompt dynamisch anpassen. |
| 6 | Text Expansion / Abbreviations | Mittel | Niedrig | [TF-262](https://linear.app/talent-factory/issue/TF-262) | Kurzformen per Sprache expandieren (z.B. "mfg" → "Mit freundlichen Grüssen"). Wispr Flow, Monologue, Typeless bieten das. |
| 7 | Adaptive Personal Dictionary | Mittel | Mittel | [TF-263](https://linear.app/talent-factory/issue/TF-263) | Auto-Glossar aus Projekt-Kontext (Package-Namen, Klassen, Symbole). Wispr Flow lernt Begriffe automatisch. |
| 8 | Diktat-History mit Volltextsuche | Niedrig | Niedrig | [TF-264](https://linear.app/talent-factory/issue/TF-264) | Vergangene Diktate wiederfinden und erneut einfuegen. SuperWhisper hat das als Major-Update (Jan 2026). |
| 9 | Multi-Cursor / Selection-aware Dictation | Mittel | Mittel | [TF-265](https://linear.app/talent-factory/issue/TF-265) | VS Code Multi-Cursor und Selection nutzen. Kein Konkurrent bietet das — einzigartiger IDE-USP. |
| 10 | Noise Gate / Auto-Pause | Niedrig | Niedrig | [TF-266](https://linear.app/talent-factory/issue/TF-266) | ffmpeg Noise Gate gegen Whisper-Halluzinationen bei Hintergrundgeraeuschen. Kein Konkurrent bietet das. |

## Marketing

| Thema | Linear | Beschreibung |
|-------|--------|-------------|
| Marketing-Strategie | [TF-267](https://linear.app/talent-factory/issue/TF-267) | Content Marketing, Community Engagement, Marketplace-Optimierung, Developer Relations, Partnerschaften. |

## Abgeschlossen

| Feature | Umgesetzt |
|---------|-----------|
| Course Correction | Feb 2026 |
| Voice Commands | Feb 2026 |
| Glossar/Dictionary | Feb 2026 |
