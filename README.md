# Verba

**The Developer's Dictation Extension** -- Voice dictation with AI-powered post-processing for VS Code.

Verba nimmt Sprache ueber das Mikrofon auf, transkribiert sie mit OpenAI Whisper und verarbeitet das Transkript mit Claude nach -- alles direkt in VS Code. Fuellwoerter werden entfernt, Saetze geglaettet und das Ergebnis an der Cursor-Position eingefuegt.

## Features

- **Diktat in Editor und Terminal** -- `Cmd+Shift+D` (Mac) / `Ctrl+Shift+D` (Windows/Linux) startet und stoppt die Aufnahme. Text wird kontextabhaengig im Editor oder Terminal eingefuegt.
- **Prompt-Templates** -- Vor jeder Aufnahme wird ein Template gewaehlt: Freitext, Commit Message, JavaDoc, Markdown oder E-Mail. Das Template steuert, wie Claude das Transkript nachbearbeitet.
- **Konfigurierbar** -- Templates sind in `settings.json` definiert und frei erweiterbar. Eigene Templates mit beliebigen Prompts hinzufuegen.
- **Bring-Your-Own-Key** -- Eigene OpenAI- und Anthropic-API-Keys. Keine Abo-Kosten, volle Datenkontrolle. Keys werden sicher in VS Code's SecretStorage gespeichert.

## Voraussetzungen

- [ffmpeg](https://ffmpeg.org/) muss installiert sein (Audioaufnahme)
- OpenAI API Key (Whisper-Transkription)
- Anthropic API Key (Claude Post-Processing)

### ffmpeg installieren

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install ffmpeg
```

**Linux (Fedora):**
```bash
sudo dnf install ffmpeg
```

**Windows:**

ffmpeg von [ffmpeg.org/download.html](https://ffmpeg.org/download.html) herunterladen und zum PATH hinzufuegen. Oder via [Chocolatey](https://chocolatey.org/):
```powershell
choco install ffmpeg
```

### Plattform-spezifische Hinweise

| Plattform | Audio-Backend | Mikrofon-Auswahl |
|-----------|--------------|-----------------|
| macOS | AVFoundation | Standard-Mikrofon |
| Linux | PulseAudio | Standard-Mikrofon |
| Windows | DirectShow | Automatisch erkannt |

**Linux:** PulseAudio muss laufen (Standard auf Ubuntu, Fedora und den meisten Desktop-Distributionen).

**Windows:** Das erste erkannte Audio-Eingabegeraet wird automatisch verwendet.

## Installation

Die Extension ist noch nicht im Marketplace veroeffentlicht. Zum lokalen Testen:

```bash
git clone https://github.com/talent-factory/verba.git
cd verba
npm install
npm run compile
```

Dann in VS Code: `F5` startet den Extension Development Host.

## Verwendung

1. `Cmd+Shift+D` -- Quick-Pick mit Template-Auswahl erscheint
2. Template waehlen (z.B. "Freitext") -- Aufnahme startet
3. Sprechen
4. `Cmd+Shift+D` -- Aufnahme stoppt, Text wird transkribiert und verarbeitet
5. Ergebnis erscheint an der Cursor-Position

Beim ersten Aufruf werden die API Keys abgefragt und sicher gespeichert.

### Terminal-Modus

Wenn der Fokus auf dem integrierten Terminal liegt, wird der diktierte Text dort eingefuegt. Mit der Einstellung `verba.terminal.executeCommand: true` wird der Text zusaetzlich mit Enter bestaetigt.

## Konfiguration

### Templates anpassen

In `settings.json` koennen eigene Templates definiert werden:

```json
{
  "verba.templates": [
    {
      "name": "Freitext",
      "prompt": "Clean up the transcript: remove filler words, smooth broken sentence starts, fix transcription errors. Keep the original language and meaning. Return only the cleaned text."
    },
    {
      "name": "Code Review",
      "prompt": "Convert this transcript into structured code review feedback with bullet points for issues found and suggestions. Keep the original language."
    }
  ]
}
```

Jedes Template besteht aus `name` (Anzeige im Quick-Pick) und `prompt` (Anweisung an Claude fuer die Nachbearbeitung).

### Einstellungen

| Setting | Typ | Default | Beschreibung |
|---------|-----|---------|--------------|
| `verba.templates` | Array | 5 Standard-Templates | Prompt-Templates fuer die Nachbearbeitung |
| `verba.terminal.executeCommand` | Boolean | `false` | Text im Terminal mit Enter bestaetigen |

## Architektur

```
Mikrofon --> ffmpeg (WAV) --> Whisper API --> Claude API --> Editor/Terminal
                                              (Template)
```

| Modul | Aufgabe |
|-------|---------|
| `recorder.ts` | ffmpeg-Kindprozess fuer Audioaufnahme |
| `transcriptionService.ts` | OpenAI Whisper API Integration |
| `cleanupService.ts` | Anthropic Claude API Integration |
| `pipeline.ts` | Verkettung der Verarbeitungsstufen |
| `templatePicker.ts` | Quick-Pick-Menue fuer Template-Auswahl |
| `insertText.ts` | Texteinfuegung in Editor oder Terminal |
| `statusBarManager.ts` | Statusbar-Anzeige (Idle/Recording/Transcribing) |

## Entwicklung

```bash
npm run compile     # TypeScript kompilieren
npm run watch       # Watch-Modus
npm run test:unit   # Unit Tests (66 Tests)
npm run test        # Alle Tests (Compile + Unit + Integration)
```

## Lizenz

Proprietaer -- talent-factory
