# Verba Web Component -- Design Document

**Date:** 2026-03-02
**Status:** Approved
**Approach:** Thin Frontend, Fat Backend (Ansatz A)

## Context

Port the Verba voice dictation concept (currently a VS Code extension) to an embeddable React component backed by a Python/FastAPI backend. The goal is a reusable `<VerbaDictation />` component that any web application can integrate.

## Key Decisions

- **Embeddable component**, not a standalone web app
- **Server-side API keys** (no BYOK)
- **Feature scope:** Core dictation + Glossary + Text Expansions (no Cost-Tracking, no Context-Aware, no Streaming)
- **Text output:** Callback (`onTranscriptionComplete`) + optional `targetRef` binding
- **No streaming UX** -- spinner during processing, then complete text

## Architecture

```
Host Web App
  <VerbaDictation
    backendUrl="https://api.example.com"
    templates={[...]}
    glossary={["Kubernetes", "FastAPI"]}
    expansions={{ "mfg": "Mit freundlichen Grüssen" }}
    onTranscriptionComplete={(text) => ...}
    targetRef={textareaRef}
  />
        |
        | POST /api/dictate (multipart: audio + config)
        v
FastAPI Backend
  1. Audio empfangen (WebM/WAV blob)
  2. Whisper API -> raw transcript
  3. Claude API -> cleaned text
  4. Response: { text, raw_transcript, duration_sec, template_used }
```

Single `/api/dictate` endpoint -- the host app sends audio + configuration, the backend returns finished text. No multi-step roundtrip.

## React Component

### Props Interface

```typescript
interface VerbaDictationProps {
  backendUrl: string;
  templates?: Template[];
  glossary?: string[];
  expansions?: Record<string, string>;
  defaultTemplate?: string;
  onTranscriptionComplete: (text: string, metadata?: DictationMetadata) => void;
  onError?: (error: DictationError) => void;
  targetRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
  locale?: string;                  // Whisper language hint (default: 'de')
  maxDurationSec?: number;          // Max recording duration (default: 300)
}

interface Template {
  name: string;
  prompt: string;
  fileTypes?: string[];
}

interface DictationMetadata {
  rawTranscript: string;
  templateUsed: string;
  durationSec: number;
}
```

### States

`idle` -> `recording` -> `uploading` -> `processing` -> `idle`

### UI Elements (minimal, styleable via CSS)

- Record button (microphone icon, pulsing during recording)
- Template dropdown (optional, only when `templates` prop is set)
- Status indicator (spinner during uploading/processing)
- No text field -- text goes out via callback or `targetRef`

### Audio Recording

- `navigator.mediaDevices.getUserMedia({ audio: true })` for microphone access
- `MediaRecorder` API with `audio/webm;codecs=opus` (broadest browser compatibility)
- Backend converts WebM -> WAV if Whisper requires it (or Whisper accepts WebM directly)

## FastAPI Backend

### Endpoint

```
POST /api/dictate
Content-Type: multipart/form-data

Fields:
  audio: File (WebM/WAV blob)
  template_prompt: str (optional)
  glossary: str (optional -- JSON array)
  expansions: str (optional -- JSON object)
  locale: str (optional -- default "de")
```

### Response

```json
{
  "text": "The cleaned text",
  "raw_transcript": "the raw whisper text uhm with filler words",
  "duration_sec": 12.4,
  "template_used": "Freitext"
}
```

### Internal Flow

1. Save audio to temp file
2. Call Whisper API (openai Python SDK) with glossary hint in `prompt` parameter
3. Build system prompt: `TEMPLATE_FRAMING` + glossary instruction + expansion instruction + template prompt (or `CLEANUP_SYSTEM_PROMPT` as fallback)
4. Call Claude API (anthropic Python SDK) with system prompt and transcript
5. Return response

### Configuration

- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as environment variables
- Optional: `WHISPER_MODEL` (default `whisper-1`), `CLAUDE_MODEL` (default `claude-haiku-4-5-20251001`)
- CORS config for allowed origins

Stateless endpoint -- no database needed. Templates, glossary, and expansions come from the frontend (i.e., the host app).

## Project Structure

```
verba-web/
├── frontend/
│   ├── src/
│   │   ├── VerbaDictation.tsx   # Main component
│   │   ├── useMediaRecorder.ts  # Hook: browser audio recording
│   │   ├── useDictation.ts      # Hook: backend communication + state machine
│   │   ├── types.ts             # Props, Metadata, Error interfaces
│   │   ├── TemplatePicker.tsx   # Dropdown component (optional)
│   │   └── index.ts             # Public API: export { VerbaDictation }
│   ├── package.json
│   └── tsconfig.json
│
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, /api/dictate
│   │   ├── transcription.py     # Whisper API call
│   │   ├── cleanup.py           # Claude API call + prompt construction
│   │   ├── prompts.py           # All prompt constants (ported from Verba)
│   │   └── config.py            # Settings via pydantic-settings / env vars
│   ├── pyproject.toml
│   └── Dockerfile
│
└── README.md
```

### Frontend Tech

- React 18+ (no Next.js -- embeddable component)
- TypeScript strict
- No state management library (React hooks suffice)
- Packaging via tsup or vite in library mode -> npm-publishable
- No UI library dependency (host app determines styling)

### Backend Tech

- Python 3.12+
- FastAPI + Uvicorn
- `openai` Python SDK (Whisper)
- `anthropic` Python SDK (Claude)
- `python-multipart` (file upload)
- `pydantic-settings` (env configuration)

## Error Handling

### Browser-side

| Scenario | Behavior |
|---|---|
| Microphone permission denied | `onError({ code: 'MIC_PERMISSION_DENIED' })` |
| MediaRecorder unsupported | `onError({ code: 'BROWSER_UNSUPPORTED' })` |
| Max recording duration reached | Recording stops automatically, upload starts |
| Backend unreachable | `onError({ code: 'NETWORK_ERROR' })` after 30s timeout |
| Double-click on Record | State machine prevents double start; second click = stop |

### Backend-side

| Scenario | Behavior |
|---|---|
| Empty/corrupt audio file | HTTP 422 with clear error message |
| Whisper API error (401/429/500) | HTTP 502 `{ error: "transcription_failed", detail: "..." }` |
| Claude API error | HTTP 502 `{ error: "cleanup_failed" }` -- raw transcript included in response |
| Claude returns empty text | Fallback to raw transcript (same logic as Verba's `fallbackIfEmpty`) |
| Audio too long (>10min) | HTTP 413, configurable via `MAX_AUDIO_DURATION_SEC` |

### Error Interface

```typescript
interface DictationError {
  code: 'MIC_PERMISSION_DENIED' | 'BROWSER_UNSUPPORTED' | 'NETWORK_ERROR'
      | 'TRANSCRIPTION_FAILED' | 'CLEANUP_FAILED' | 'AUDIO_TOO_LONG';
  message: string;
  rawTranscript?: string;
}
```

## Code Reuse from Verba

### Ported 1:1 (as Python strings)

| Verba Source | Target | Type |
|---|---|---|
| `CLEANUP_SYSTEM_PROMPT` | `backend/app/prompts.py` | String constant |
| `TEMPLATE_FRAMING` | `backend/app/prompts.py` | String constant |
| `COURSE_CORRECTION_INSTRUCTION` | `backend/app/prompts.py` | String constant |
| `VOICE_COMMANDS_INSTRUCTION` | `backend/app/prompts.py` | String constant |
| Glossary injection logic | `backend/app/cleanup.py` | Prompt construction |
| Expansions injection logic | `backend/app/cleanup.py` | Prompt construction |
| Default templates (8) | Frontend defaults or backend config | Data structure |
| `Template` interface | `frontend/src/types.ts` | TypeScript interface |

### Written new

| Component | Reason |
|---|---|
| `useMediaRecorder` hook | Browser MediaRecorder instead of ffmpeg |
| `useDictation` hook | HTTP upload + state machine |
| `VerbaDictation.tsx` | React UI instead of VS Code StatusBar |
| `backend/app/main.py` | FastAPI endpoint instead of VS Code Extension |
| `backend/app/transcription.py` | Python openai SDK instead of Node.js openai SDK |
| `backend/app/cleanup.py` | Python anthropic SDK instead of Node.js anthropic SDK |

### Estimated ratio: ~60% new implementation, ~40% ported logic/prompts.

The core value of Verba -- the carefully developed prompts for course correction, voice commands, glossary integration, and template framing -- transfers 1:1.

## Out of Scope

- Authentication (host app responsibility)
- Cost tracking
- Local Whisper transcription (no whisper.cpp)
- Context-aware templates (no embedding/code context)
- Terminal support, multi-cursor, selection replacement
- Streaming UX
