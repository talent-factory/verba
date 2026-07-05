# Voice Commands & Course Correction

Two prompt-engineering features make dictated speech read like written text instead of a verbatim transcript: **voice commands** turn spoken formatting cues into actual formatting, and **course correction** removes self-corrections so only what you meant to say survives. Both are **always active** — there's no setting to turn them off — and both are shared `@verba/core` logic (`packages/core/src/cleanupService.ts`), applied identically by the VS Code extension and the macOS app.

## Voice Commands

Say a formatting instruction while dictating, and Claude converts it to the actual formatting during cleanup — no manual editing afterward.

| Say | Result |
|-----|--------|
| "New paragraph" / "Neuer Absatz" | Paragraph break |
| "New line" / "Neue Zeile" | Line break |
| "Period" / "Punkt" | `.` |
| "Comma" / "Komma" | `,` |
| "Colon" / "Doppelpunkt" | `:` |
| "Semicolon" / "Semikolon" | `;` |
| "Question mark" / "Fragezeichen" | `?` |
| "Exclamation mark" / "Ausrufezeichen" | `!` |
| "Bullet point" / "Aufzählung" | `- ` (list item) |
| "Number one/two/three" / "Nummer eins/zwei/drei" | `1. ` / `2. ` / `3. ` |

Voice commands are **language-independent**: the underlying instruction is given to Claude once, and it recognizes the command phrase in whichever language you're speaking, mixed or not. Claude also uses surrounding context to resolve ambiguity — for example, "period" spoken as punctuation versus "period" used as an ordinary word in a sentence.

## Course Correction

Real speech includes self-corrections: "let's meet tomorrow — no wait, on Friday at ten." Course correction detects phrases like these and keeps only the final, corrected statement, discarding the abandoned first attempt. The result: "let's meet on Friday at ten."

Recognized correction phrases include "no wait", "I meant", "actually, rather", "correction", and equivalent patterns in both German and English — matched by meaning, not by a fixed phrase list, so natural variations are still caught.

## Where this happens

Both instructions are folded into every Claude request made by `CleanupService` — the default cleanup prompt *and* the framing added around every [custom template](templates.md) — so they apply no matter which template is active. This is part of why the logic lives once in `@verba/core` rather than being reimplemented per surface: get it right once, and dictation reads naturally everywhere you use Verba.
