# Architecture

Verba follows a pipeline architecture where each stage transforms the data before passing it to the next.

## Processing Pipeline

```
Microphone → ffmpeg (WAV) → Deepgram API → Claude API → Editor/Terminal
                                            (Template)
```

1. **Recording** — ffmpeg captures audio from the microphone as a WAV file.
2. **Transcription** — The WAV file is sent to Deepgram's Nova-3 API, which returns raw text.
3. **Post-Processing** — The transcript is sent to Claude with the active template's prompt. Context-aware templates include code snippets from the semantic search.
4. **Insertion** — The processed text is inserted at the cursor position in the editor, or pasted into the terminal.

## Module Overview

| Module | Responsibility |
|--------|---------------|
| `extension.ts` | Extension entry point, command registration, activation |
| `recorder.ts` | ffmpeg child process for audio recording (macOS/Linux/Windows) |
| `transcriptionService.ts` | Deepgram Nova-3 API integration with hallucination detection and glossary hints |
| `cleanupService.ts` | Anthropic Claude API integration for post-processing (streaming with real-time progress, course correction, voice commands, glossary protection) |
| `pipeline.ts` | Orchestration of recording → transcription → cleanup → insertion |
| `templatePicker.ts` | Quick Pick menu for template selection with auto-reuse |
| `insertText.ts` | Context-aware text insertion (editor vs terminal) |
| `statusBarManager.ts` | Status bar display (Idle/Recording/Transcribing/Processing with character counter + template name) |
| `contextProvider.ts` | Unified context search abstraction |
| `grepaiProvider.ts` | grepai CLI wrapper for semantic code search |
| `embeddingService.ts` | OpenAI text-embedding-3-small for local embeddings |
| `indexer.ts` | File chunking and incremental index updates |
| `vectorStore.ts` | In-memory vector store with cosine similarity search |

## Context-Aware Pipeline

For context-aware templates, the pipeline includes an additional step before post-processing:

```
Transcript → Context Search → Claude API (transcript + code snippets) → Result
```

The context search uses one of two providers:

- **grepai** — External CLI tool that provides semantic search over the codebase.
- **OpenAI Embeddings** — Local vector store built from chunked project files, queried via cosine similarity.

## Transcription Provider

Verba uses **Deepgram Nova-3** for cloud transcription (both single-shot and continuous mode). This replaced OpenAI Whisper after systematic evaluation of 7 providers -- Whisper's hallucination problem on short audio segments made it unreliable for continuous dictation. Deepgram was chosen for its built-in VAD, WebSocket streaming, lower cost ($0.0043/min vs $0.006/min), and minimal hallucinations.

Local offline transcription via **whisper.cpp** remains available as an alternative.

For the full evaluation and decision rationale, see [ADR: Deepgram Migration](adr-deepgram-migration.md).

## Cross-Platform Audio

The `recorder.ts` module handles platform differences:

| Platform | Audio Framework | Device Listing |
|----------|----------------|---------------|
| macOS | AVFoundation | `ffmpeg -f avfoundation -list_devices` |
| Linux | PulseAudio | `pactl list sources` |
| Windows | DirectShow | `ffmpeg -f dshow -list_devices` + PowerShell fallback |
