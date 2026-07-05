# How Verba Works

Every dictation — whether triggered from the VS Code extension or the macOS app — goes through the same four-stage pipeline:

```
Microphone → Record → Transcribe → Post-Process → Insert / Paste
              (host)   (Deepgram Nova-3     (Claude via
                        or whisper.cpp)      CleanupService)
```

1. **Record** — audio is captured from the microphone while you speak.
2. **Transcribe** — the recording is converted to raw text, by default via the **Deepgram Nova-3** cloud API, or via **whisper.cpp** locally and offline.
3. **Post-process** — the raw transcript is cleaned up and shaped by **Claude**, using your active [template](templates.md), your [glossary and expansions](glossary.md), and shared instructions for [voice commands and course correction](voice-commands.md).
4. **Insert / paste** — the finished text lands wherever you were about to type: the editor, the terminal, or the frontmost app on macOS.

## One shared core, two surfaces

Steps 2 and 3 — transcription and post-processing — are **not** duplicated per platform. They live once in `@verba/core` (`packages/core/src/deepgramProvider.ts`, `packages/core/src/cleanupService.ts`, `packages/core/src/pipeline.ts`) and are used unchanged by both the VS Code extension and the macOS app. A fix or improvement to filler-word removal, course correction, or glossary handling applies to both surfaces at once.

What *does* differ between the two surfaces is narrow and mechanical — capture and delivery, not the dictation logic itself:

| Stage | Shared logic (`@verba/core`) | VS Code specifics | macOS specifics |
|-------|-------------------------------|--------------------|------------------|
| Record | — | `ffmpeg` child process (WAV file, or raw PCM for continuous mode) | `cpal` audio capture in the Rust/Tauri backend |
| Transcribe | `deepgramProvider.ts` — Deepgram Nova-3 request, glossary keyterm truncation | Also offers local `whisper.cpp` as an [offline alternative](../vscode/offline.md) | Deepgram only |
| Post-process | `cleanupService.ts` — Claude call, course correction, voice commands, glossary/expansion instructions, active [template](templates.md) | API key read from `vscode.SecretStorage` | API key read from the macOS Keychain |
| Insert / paste | — | Insert at cursor, into a selection, or into the integrated terminal | Paste into whichever app is currently frontmost |

The pipeline itself — feed the output of one stage into the next — is modeled by `DictationPipeline` / `ProcessingStage` in `packages/core/src/pipeline.ts`: a small pipes-and-filters orchestrator that both hosts instantiate, plugging their own recording and insertion adapters in at the two ends while the middle stays shared.

## Where to go next

- [Prompt Templates](templates.md) — what gets sent to Claude and how to customize it
- [Glossary & Expansions](glossary.md) — protecting terms and expanding abbreviations
- [Voice Commands & Course Correction](voice-commands.md) — spoken formatting and self-correction handling
- [Bring Your Own Key & Privacy](byok.md) — which keys are used, and where they're stored
