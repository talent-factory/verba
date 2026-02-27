# LLM Cost Tracking & Overview — Design Document

**Issue:** TF-270
**Date:** 2026-02-27
**Status:** Approved

## Goal

Track actual API usage costs from every LLM call (Whisper transcription, OpenAI embeddings, Claude processing) and display cumulative costs in a WebView panel — both per session and across all sessions.

## Architecture

```
API Call -> Service (Transcription/Cleanup/Embedding)
                | usage data
           CostTracker  ->  globalState (persistent)
                |
           WebView Panel (card layout)
```

### New Files

| File | Purpose |
|------|---------|
| `src/costTracker.ts` | Service: collects usage data, calculates costs, persists to globalState |
| `src/costOverviewPanel.ts` | WebView: card layout with session and total costs |

### Modified Files

| File | Change |
|------|--------|
| `src/cleanupService.ts` | Extract usage from Anthropic response |
| `src/embeddingService.ts` | Extract usage from OpenAI Embedding response |
| `src/extension.ts` | Instantiate CostTracker, register command, report audio duration |
| `package.json` | New command `dictation.showCostOverview` |

## CostTracker Service

### Pricing Constants

```typescript
const PRICING = {
  'whisper-1':                 { perMinute: 0.006 },
  'text-embedding-3-small':   { inputPer1M: 0.020 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1.00, outputPer1M: 5.00 },
};
```

### Data Model

```typescript
interface UsageRecord {
  timestamp: number;
  model: string;
  provider: 'openai' | 'anthropic';
  inputTokens?: number;
  outputTokens?: number;
  audioDurationSec?: number;
  costUsd: number;
}
```

### API

| Method | Description |
|--------|-------------|
| `trackWhisperUsage(audioDurationSec)` | Cost = duration x $0.006/min |
| `trackClaudeUsage(inputTokens, outputTokens)` | Cost = tokens x price/1M |
| `trackEmbeddingUsage(promptTokens)` | Cost = tokens x price/1M |
| `getSessionCosts()` | Sum since extension start |
| `getTotalCosts()` | Sum across all sessions (from globalState) |
| `getRecords(scope: 'session' \| 'total')` | Records for WebView rendering |
| `resetTotalCosts()` | Reset persistent total costs |

### Persistence

- Session costs: in-memory array of `UsageRecord[]`
- Total costs: `vscode.ExtensionContext.globalState` (key: `verba.costRecords`)
- On each `track*()` call: append to session array + update globalState

## WebView Panel

### Layout

Card layout with one card per model, grouped by provider:

```
+---------------------------------------------+
|  LLM Cost Overview         [Session | Total] |
+---------------------------------------------+
|                                              |
|  -- OpenAI --                                |
|  +------------------+  +------------------+  |
|  | Whisper-1        |  | Embedding-3-small|  |
|  | Transcription    |  | Embedding        |  |
|  |                  |  |                   |  |
|  | 12.5 min audio   |  | 45,200 tokens    |  |
|  | $0.075           |  | $0.001           |  |
|  +------------------+  +------------------+  |
|                                              |
|  -- Anthropic --                             |
|  +------------------+                        |
|  | Claude Haiku 4.5 |                        |
|  | Processing       |                        |
|  |                  |                        |
|  | In: 8,300 tokens |                        |
|  | Out: 2,100 tokens|                        |
|  | $0.019           |                        |
|  +------------------+                        |
|                                              |
|  -- Total: $0.095 --                         |
+---------------------------------------------+
```

### Theming

- Uses VS Code CSS variables (`--vscode-editor-background`, `--vscode-editor-foreground`, etc.)
- No external CSS framework
- Adapts to light and dark themes automatically

### Toggle

- Session / Total toggle at the top
- WebView communicates with extension via `postMessage` API

## Integration Points

### cleanupService.ts

After `messages.create()` (sync) and after stream completion:
```typescript
const usage = response.usage; // { input_tokens, output_tokens }
costTracker.trackClaudeUsage(usage.input_tokens, usage.output_tokens);
```

For streaming: access `stream.finalMessage()` after iteration to get usage.

### embeddingService.ts

After `embeddings.create()`:
```typescript
const usage = response.usage; // { prompt_tokens, total_tokens }
costTracker.trackEmbeddingUsage(usage.prompt_tokens);
```

### extension.ts

After Whisper transcription, calculate audio duration:
```typescript
// Extract duration from recorded audio file (ffprobe or file stats)
costTracker.trackWhisperUsage(audioDurationSeconds);
```

## Error Handling

- Missing usage data (API change): graceful skip, log warning, no crash
- globalState write failure: log error, continue with session-only tracking
- CostTracker injected via constructor (consistent with existing patterns)

## Testing

- Unit tests for cost calculation (each model, edge cases)
- Unit tests for record aggregation (session vs total)
- Unit tests for WebView HTML generation
- Integration test for command registration
