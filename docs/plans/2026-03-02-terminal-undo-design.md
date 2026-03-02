# Terminal Undo via Backspace

**Issue:** TF-258
**Date:** 2026-03-02

## Problem

Undo after terminal dictation shows "No dictation to undo" because terminal insertions clear the undo record. Editor undo works; terminal undo does not.

## Design

Send backspace characters (`\x7F`) to the terminal to delete the previously inserted text.

### Two scenarios

| `executeCommand` | Text status | Undo? |
|---|---|---|
| `false` (default) | In input line, not submitted | Yes, via backspaces |
| `true` | Already executed | No — show info message |

### DictationRecord changes

Extend the existing interface to support both editor and terminal records:

```typescript
export interface DictationRecord {
  readonly type: 'editor' | 'terminal';
  readonly insertedText: string;
  // Editor only:
  readonly documentUri?: string;
  readonly insertedRanges?: InsertedRange[];
  readonly originalTexts?: string[];
  // Terminal only:
  readonly wasExecuted?: boolean;
}
```

### Undo command logic

- `type === 'editor'` — existing range-based reverse edit
- `type === 'terminal' && !wasExecuted` — `terminal.sendText('\x7F'.repeat(text.length), false)`
- `type === 'terminal' && wasExecuted` — info message, no undo

### Recording changes

In `handleDictation` (extension.ts), replace `clearLastDictation()` for terminal insertions with `recordDictation()` using `type: 'terminal'`.

### Limitation

Cannot verify whether the user has manually edited the terminal input line before undoing. Analogous to the editor case (which checks if text still matches), but without verification capability.
