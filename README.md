<p align="center">
  <img src="images/icon.png" alt="Verba" width="128" height="128">
</p>

<h1 align="center">Verba</h1>

<p align="center">
  <strong>The Developer's Dictation Extension</strong><br>
  Voice dictation with AI-powered post-processing for VS Code.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=talent-factory.verba"><img src="https://img.shields.io/visual-studio-marketplace/v/talent-factory.verba" alt="Visual Studio Marketplace"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://github.com/talent-factory/verba"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue" alt="Platform"></a>
</p>

<p align="center">
  Verba records speech via your microphone, transcribes it with OpenAI Whisper, and post-processes the transcript with Claude — all directly inside VS Code. Filler words are removed, sentences are smoothed, and the result is inserted at your cursor position.
</p>

---

## Features

- **Dictation in Editor and Terminal** -- `Cmd+Shift+D` (Mac) / `Ctrl+Shift+D` (Windows/Linux) starts and stops recording. Text is inserted contextually in the editor or terminal.
- **Prompt Templates** -- Choose a template before each recording: Free Text, Commit Message, JavaDoc, Markdown, or Email. The template controls how Claude post-processes the transcript.
- **Fully Configurable** -- Templates are defined in `settings.json` and freely extensible. Add custom templates with any prompt.
- **Bring Your Own Key** -- Use your own OpenAI and Anthropic API keys. No subscription costs, full data control. Keys are stored securely in VS Code's SecretStorage.

## Prerequisites

- [ffmpeg](https://ffmpeg.org/) must be installed (audio recording)
- OpenAI API Key (Whisper transcription)
- Anthropic API Key (Claude post-processing)

### Installing ffmpeg

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

Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH, or via [Chocolatey](https://chocolatey.org/):
```powershell
choco install ffmpeg
```

### Platform-Specific Notes

| Platform | Audio Backend | Microphone Selection |
|----------|--------------|---------------------|
| macOS | AVFoundation | Default microphone |
| Linux | PulseAudio | Default microphone |
| Windows | DirectShow | Auto-detected |

**Linux:** PulseAudio must be running (default on Ubuntu, Fedora, and most desktop distributions).

**Windows:** The first detected audio input device is used automatically.

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=talent-factory.verba):

```
ext install talent-factory.verba
```

Or search for "Verba" in the VS Code Extensions sidebar.

## Quick Start

1. `Cmd+Shift+D` -- Quick Pick with template selection appears
2. Choose a template (e.g., "Free Text") -- recording starts
3. Speak
4. `Cmd+Shift+D` -- recording stops, text is transcribed and processed
5. Result appears at your cursor position

On first use, you will be prompted for your API keys, which are stored securely.

### Terminal Mode

When the integrated terminal is focused, dictated text is inserted there instead. With `verba.terminal.executeCommand: true`, the text is additionally submitted with Enter.

## Configuration

### Custom Templates

Define custom templates in `settings.json`:

```json
{
  "verba.templates": [
    {
      "name": "Free Text",
      "prompt": "Clean up the transcript: remove filler words, smooth broken sentence starts, fix transcription errors. Keep the original language and meaning. Return only the cleaned text."
    },
    {
      "name": "Code Review",
      "prompt": "Convert this transcript into structured code review feedback with bullet points for issues found and suggestions. Keep the original language."
    }
  ]
}
```

Each template consists of `name` (displayed in Quick Pick) and `prompt` (instruction sent to Claude for post-processing).

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `verba.templates` | Array | 5 built-in templates | Prompt templates for post-processing |
| `verba.terminal.executeCommand` | Boolean | `false` | Submit text in terminal with Enter |

## Architecture

```
Microphone --> ffmpeg (WAV) --> Whisper API --> Claude API --> Editor/Terminal
                                                (Template)
```

| Module | Purpose |
|--------|---------|
| `recorder.ts` | ffmpeg child process for audio recording |
| `transcriptionService.ts` | OpenAI Whisper API integration |
| `cleanupService.ts` | Anthropic Claude API integration |
| `pipeline.ts` | Processing stage orchestration |
| `templatePicker.ts` | Quick Pick menu for template selection |
| `insertText.ts` | Text insertion into editor or terminal |
| `statusBarManager.ts` | Status bar display (Idle/Recording/Transcribing) |

## Development

```bash
npm run compile     # Compile TypeScript
npm run watch       # Watch mode
npm run test:unit   # Unit tests
npm run test        # All tests (compile + unit + integration)
```

## Contributing

Found a bug or have a feature request? [Open an issue](https://github.com/talent-factory/verba/issues).

## License

[MIT](LICENSE)
