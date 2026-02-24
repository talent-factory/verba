# Design: Marketplace-Polishing

**Datum:** 2026-02-24
**Ansatz:** A (Minimaler Fix)

## Ziel

Die VS Code Extension-Detailseite aufwerten: Changelog-Tab sichtbar machen, Screenshots/GIFs einbetten, Badges und Kategorien polieren.

## Aenderungen

### 1. Changelog sichtbar machen

`CHANGELOG.md` aus `.vscodeignore` entfernen. VS Code erkennt die Datei automatisch und zeigt den "Changelog"-Tab.

### 2. Screenshot-Assets

Neue Dateien in `images/screenshots/`:

| Datei | Typ | Inhalt |
|-------|-----|--------|
| `template-picker.png` | Screenshot | Quick Pick mit 5 Templates |
| `dictation-workflow.gif` | GIF | Kompletter Diktat-Flow (~5-10s) |
| `audio-device-selection.png` | Screenshot | Mikrofon-Auswahl Quick Pick |
| `terminal-mode.png` | Screenshot | Diktierter Text im Terminal |
| `status-bar.png` | Screenshot | Status Bar Zustaende |

Bilder in @2x Retina, Darstellung max 800px breit im README.

### 3. README-Struktur

Bilder in bestehende Sektionen einbetten:

- **Features**: Hero-GIF (`dictation-workflow.gif`) direkt unter Ueberschrift
- **Quick Start**: `template-picker.png` bei Schritt 1
- **Platform-Specific Notes**: `audio-device-selection.png`
- **Terminal Mode**: `terminal-mode.png`

### 4. Badges & Kategorien

- Installs-Badge ergaenzen
- Kategorie `Other` durch `Snippets` ersetzen

### 5. .vscodeignore

- `CHANGELOG.md` entfernen (soll ins VSIX)
- `images/screenshots/` NICHT excluden (muss ins VSIX fuer lokale Installation)
