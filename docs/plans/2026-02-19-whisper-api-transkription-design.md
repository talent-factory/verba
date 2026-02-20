# TF-246: Whisper API Transkription - Design

## Goal

Send recorded audio to OpenAI Whisper API and insert the transcript at the cursor position. Automatic flow: stop recording triggers transcription immediately, no user confirmation.

## Decisions

- **UX flow:** Automatic — stop recording triggers transcription and text insertion
- **API key setup:** Prompt on first use, stored in `vscode.SecretStorage`
- **Language:** Auto-detect (no language hint to Whisper)
- **Text processing:** Raw from Whisper, no cleanup (Phase 4 handles that)
- **Architecture:** Pipeline pattern with composable stages

## Architecture: Pipeline Pattern

### Core Concept

The pipeline processes audio after recording stops. Recording is interactive (user-triggered). The post-recording flow is a linear chain:

```
WAV file path -> [Transcribe] -> text -> [future: PostProcess] -> text -> Insert at cursor
```

Each stage implements `ProcessingStage`: `process(input: string) => Promise<string>`. The pipeline composes them sequentially.

### New Files

| File | Purpose |
|------|---------|
| `src/pipeline.ts` | `ProcessingStage` interface and `DictationPipeline` class |
| `src/transcriptionService.ts` | Wraps OpenAI SDK, implements `ProcessingStage` |
| `src/test/unit/pipeline.test.ts` | Pipeline unit tests |
| `src/test/unit/transcriptionService.test.ts` | Transcription service unit tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/extension.ts` | Orchestrate pipeline after recording stops, insert text at cursor |
| `src/statusBarManager.ts` | Add `setTranscribing()` state |
| `package.json` | Add `openai` dependency |

### Pipeline Interface

```typescript
export interface ProcessingStage {
  readonly name: string;
  process(input: string): Promise<string>;
}

export class DictationPipeline {
  private stages: ProcessingStage[] = [];
  addStage(stage: ProcessingStage): void;
  async run(input: string): Promise<string>;
}
```

### TranscriptionService

```typescript
export class TranscriptionService implements ProcessingStage {
  readonly name = 'Whisper Transcription';
  constructor(private secretStorage: vscode.SecretStorage);
  async process(input: string): Promise<string>;  // input = WAV path, output = transcript
  private async getApiKey(): Promise<string>;      // prompt on first use
}
```

### Flow in extension.ts

```typescript
const pipeline = new DictationPipeline();
pipeline.addStage(new TranscriptionService(context.secrets));

// On stop:
const filePath = await recorder.stop();
statusBar.setTranscribing();
const transcript = await pipeline.run(filePath);
insertTextAtCursor(transcript);
statusBar.setIdle();
```

## Error Handling

| Error | Detection | User Message |
|-------|-----------|-------------|
| No API key (user cancels) | `getApiKey()` returns undefined | "OpenAI API key required for transcription." |
| Invalid API key | OpenAI SDK 401 | "Invalid OpenAI API key." + clear stored key |
| Network/API error | OpenAI SDK other errors | "Transcription failed: {message}" |
| Empty transcript | Empty string from Whisper | "No speech detected in recording." |

On 401, the stored key is deleted so the user gets re-prompted on next attempt.

## Status Bar States

```
Idle:          "$(mic) Verba"
Recording:     "$(circle-filled) Recording..."
Transcribing:  "$(loading~spin) Transcribing..."   <- NEW
```

## Audio File Cleanup

Temporary WAV file is deleted after transcription completes (success or error). Handled in `extension.ts`.

## Testing

- **`pipeline.test.ts`**: Stage chaining, error propagation, empty pipeline
- **`transcriptionService.test.ts`**: API key retrieval, Whisper call parameters, error handling (401, network, empty transcript)
- **Integration**: Extend `extension.test.ts` for full flow with mocked OpenAI

All tests mock the `openai` package and `SecretStorage` using sinon fakes (matching existing test patterns).
