# Offline Transcription via whisper.cpp

## Context

All top competitors (Wispr Flow, SuperWhisper, VoiceInk) offer offline transcription.
Verba currently requires an OpenAI API key for Whisper transcription, creating a privacy
and cost gap. Linear issue: TF-257.

## Decision

Add local transcription via the whisper.cpp CLI as an alternative to the OpenAI Whisper API.

### Key Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Binary management | Direct CLI wrapper | Same pattern as ffmpeg; npm packages are unmaintained or just CLI wrappers anyway |
| Model management | Auto-download via VS Code command | Downloads from Hugging Face to globalStorage; no bundling, no manual paths |
| Abstraction | Strategy pattern on existing class | Minimal disruption to existing tests and code |
| Platform scope (v1) | macOS only | Ship fast, validate approach, expand in follow-up PRs |

## Architecture

### Strategy Pattern on TranscriptionService

```typescript
class TranscriptionService {
  private provider: 'openai' | 'local';

  async process(input: string, glossary?: string[]): Promise<string> {
    if (this.provider === 'local') {
      return this.processLocal(input, glossary);
    }
    return this.processOpenAI(input, glossary);
  }

  private async processOpenAI(input: string, glossary?: string[]): Promise<string> {
    // existing Whisper API logic
  }

  private async processLocal(input: string, glossary?: string[]): Promise<string> {
    // whisper.cpp CLI wrapper
  }
}
```

### New Settings

```json
"verba.transcription.provider": "openai" | "local"  // default: "openai"
"verba.transcription.localModel": "base"             // default: "base"
```

### New Command

- `dictation.downloadModel` — "Verba: Download Whisper Model"
- Quick Pick: tiny (~75MB), base (~142MB), small (~466MB), medium (~1.5GB), large (~3GB)
- Downloads GGML model from Hugging Face to `context.globalStorageUri/models/`
- Progress bar via `vscode.window.withProgress`

### Data Flow (Local Mode)

```
Microphone → ffmpeg (WAV 16kHz) → whisper.cpp CLI → raw text → Claude → Editor
                                    ↑
                              --model ggml-base.bin
                              --output-json
                              --prompt "glossary terms"
```

### Binary Discovery (macOS)

Paths checked in order:
1. `/opt/homebrew/bin/whisper-cpp`
2. `/usr/local/bin/whisper-cpp`
3. `which whisper-cpp` fallback

### Error Handling

- No silent fallback between providers
- If `provider: 'local'` but binary missing: actionable error with `brew install whisper-cpp`
- If model missing: prompt to run "Verba: Download Whisper Model"
- If transcription fails: descriptive error with whisper.cpp stderr

## Files to Modify/Create

| File | Change |
|------|--------|
| `src/transcriptionService.ts` | Strategy pattern, `processLocal()`, `findWhisperCpp()` |
| `src/extension.ts` | Read provider setting, pass to service, register download command |
| `package.json` | New settings + new command |
| `src/test/unit/transcriptionService.test.ts` | Tests for local transcription path |
| `docs/guide/configuration.md` | Document new settings |
| `README.md` | Document offline transcription feature |

## Out of Scope

- Linux/Windows binary paths (follow-up PR)
- Streaming transcription progress
- Model auto-update
