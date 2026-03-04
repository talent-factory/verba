# ADR: Transcription Provider Migration to Deepgram Nova-3

**Status:** Accepted (March 2024)
**Issue:** [TF-272](https://linear.app/talent-factory/issue/TF-272)
**Related:** [TF-260](https://linear.app/talent-factory/issue/TF-260) (Continuous Dictation)

## Context

Verba originally used OpenAI's Whisper API (`whisper-1` model) for speech-to-text transcription. During development of the Continuous Dictation feature (TF-260), a fundamental limitation was discovered: **Whisper hallucinates on short audio segments**, producing completely fabricated text.

### The Problem

When audio is split into segments (5-15 seconds each, separated by natural speech pauses), Whisper produces non-deterministic hallucinations on 10-20% of segments:

| Actual Speech | Whisper Output |
|---|---|
| German legal text about company branches | "Microsoft Office Word Document MSWordDoc Word.Document.8" |
| German legal text about business activities | "In this video tutorial we've installed Ubuntu 17.04..." |
| German legal text about mining companies | "on, in, in, in, Solutions, eBay, FidelityCode..." |
| Silence after pause | "Thank you for watching!" |

These hallucinations occur on **real speech** (not just silence), making them impossible to filter without discarding legitimate transcriptions. This is a known limitation of the Whisper model architecture, not a Verba code bug.

### Additional Issue: Audio Pipeline Latency

The initial continuous dictation approach used ffmpeg's `silencedetect` filter to identify pauses, then extracted segments from the recording file. ffmpeg's internal pipeline introduces 2-5 seconds of latency between detected silence timestamps and actual file content, causing segment extraction timing issues.

Over 10 iterations of attempted mitigations (raw PCM, flush packets, file-growth polling, byte-level extraction, WAV format switching, prompt context, volume detection) failed to resolve the core hallucination problem.

## Alternatives Evaluated

| Provider | Hallucinations | Streaming | Built-in VAD | Price/min | Language Support | Integration Effort |
|----------|---------------|-----------|-------------|-----------|-----------------|-------------------|
| **OpenAI Whisper API** | Frequent, severe | No | No | $0.006 | Excellent | Existing |
| **Deepgram Nova-3** | Rare (built-in VAD) | Yes (WebSocket) | Yes | $0.0043 | Good (100+ langs) | Medium |
| **Google Cloud STT v2** | Rare | Yes (gRPC) | Yes | $0.006 | Excellent | Large (gRPC, auth) |
| **AssemblyAI** | Rare | Yes (WebSocket) | Yes | $0.010 | Good | Medium |
| **Azure Speech Services** | Rare | Yes | Yes | $0.010 | Excellent | Medium (Azure SDK) |
| **Groq Whisper** | Same as Whisper | No | No | Cheaper | Same | Small (API compat) |
| **Local whisper.cpp** | Same as Whisper | No | Threshold only | Free | Same | Existing |

An alternative architecture (stop-and-restart ffmpeg at each pause) was also considered but rejected because it still relies on Whisper and would not eliminate the hallucination problem.

## Decision

**Deepgram Nova-3** was selected as the new transcription provider for both single-shot and continuous dictation.

### Key Reasons

1. **Built-in VAD** -- Deepgram's Voice Activity Detection handles pause detection and utterance segmentation at the API level. This eliminates the need for ffmpeg `silencedetect`, segment extraction, and all associated timing issues.

2. **Minimal hallucinations** -- Nova-3's architecture produces significantly fewer fabricated outputs compared to Whisper, especially on short segments.

3. **WebSocket streaming** -- Enables true real-time continuous dictation. Audio is piped from ffmpeg directly to the Deepgram WebSocket, and completed utterances are emitted as events. No file I/O, no segment extraction.

4. **Lower cost** -- $0.0043/min vs $0.006/min (28% reduction).

5. **Shared SDK** -- Both single-shot (`transcribeFile`) and continuous (`LiveClient` WebSocket) use the same `@deepgram/sdk` package and API key.

## Consequences

### Positive

- Continuous dictation works reliably (no hallucinations, no timing issues)
- Single-shot transcription cost reduced by 28%
- Simpler architecture for continuous mode (ffmpeg stdout pipe to WebSocket)
- Single API key for all transcription modes

### Negative

- New API key required (Deepgram instead of OpenAI for transcription)
- Users with `"provider": "openai"` in settings must update to `"deepgram"`
- `openai` npm package is still required for embeddings (context search)
- Glossary integration changes from Whisper `prompt` parameter to Deepgram `keywords` parameter (different token budget: ~300 vs ~224 tokens)

### Neutral

- Local offline transcription via whisper.cpp remains unchanged
- Claude post-processing pipeline is not affected
