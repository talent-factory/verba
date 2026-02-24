# Cross-Platform Audio-Aufnahme Design

**Ziel:** Verba soll auf macOS, Linux und Windows funktionieren.

**Ansatz:** Platform-Config-Map in `recorder.ts` -- minimaler Eingriff, keine neuen Klassen.

## Plattform-Konfiguration

| Plattform | ffmpeg Input-Format | Input-Device | ffmpeg-Suche |
|-----------|-------------------|--------------|--------------|
| macOS | `avfoundation` | `:default` | Homebrew-Pfade, `which` |
| Linux | `pulse` (PulseAudio) | `default` | `/usr/bin/ffmpeg`, `which` |
| Windows | `dshow` (DirectShow) | Auto-Detect | `where ffmpeg` |

## Aenderungen

### recorder.ts

1. **Platform-Check ersetzen** -- Harter `darwin`-Check wird durch `getPlatformAudioConfig()` ersetzt. Nicht-unterstuetzte Plattformen werfen weiterhin einen Fehler.

2. **`getPlatformAudioConfig()`** -- Neue private Methode:
   - Liefert `inputFormat` und `inputDevice` pro Plattform
   - Windows: Ruft `detectWindowsAudioDevice()` fuer Auto-Detection auf

3. **`findFfmpeg()` erweitern** -- Plattformspezifische Suchpfade:
   - macOS: `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`
   - Linux: `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`
   - Windows: `where ffmpeg` statt `which ffmpeg`

4. **`detectWindowsAudioDevice()`** -- Neue private Methode:
   - Fuehrt `ffmpeg -list_devices true -f dshow -i dummy` aus
   - Parst erstes Audio-Geraet aus stderr-Output
   - Fehler wenn kein Geraet gefunden

5. **`start()` anpassen** -- ffmpeg-Argumente dynamisch aus Config zusammenbauen

### README.md

- Installationsanleitungen fuer macOS, Linux und Windows

### Tests

- Platform-Mock statt hardcoded darwin-Check
- Windows-Autodetect-Parsing testen
- Fehlermeldungen pro Plattform testen

## Entscheidungen

- **PulseAudio** als Linux-Backend (Standard auf Ubuntu/Fedora/den meisten Desktop-Distros)
- **Auto-Detect** fuer Windows-Mikrofon (kein manuelles Setting noetig)
- **Kein separates Recorder-Interface** -- Unterschiede sind zu gering (3 ffmpeg-Flags + Pfadsuche)
