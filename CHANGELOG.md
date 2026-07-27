# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.1](https://github.com/talent-factory/verba/compare/verba-v0.7.0...verba-v0.7.1) (2026-07-27)


### Fixed

* Agent-Prompt-Template — strukturierter Prompt, Multiline-Paste & grepai-Scope (TF-531) ([f0374b7](https://github.com/talent-factory/verba/commit/f0374b75e8996848315eddfea928ba0ece61676c))

## [Unreleased]

### Changed

- **Both hosts — Agent Instruction template now emits a structured agent prompt (TF-531):** The 🦾 Agent Instruction template no longer produces a single terse imperative line — it turns a spoken instruction into a structured prompt with `## Ziel` / `## Scope` / `## Constraints` / `## Unklar` sections. `## Ziel` (one imperative line) is mandatory and is emitted even for a short, single-action command; the remaining sections are added only for longer, multi-part requests, and any section that would be empty is omitted. Section headers follow the dictation language (German `## Ziel` / `## Scope` / `## Constraints` / `## Unklar`; English `## Goal` / `## Scope` / `## Constraints` / `## Unclear`). File paths and code symbols are kept in backticks and never invented — an unresolvable reference is placed under `## Unklar` instead of a guessed path. A non-actionable dictation is still returned as lightly-cleaned prose rather than refused. Shared via `@verba/core`'s default template and kept in lockstep across both hosts by the parity test.

### Added

- **macOS — `## Scope` resolved from the focused repo (TF-531):** On macOS the Agent Instruction template's `## Scope` is now filled from real code. The focused herdr pane is mapped to its repo (agent pane `cwd`, shell pane `foreground_cwd`) and the native `grepai_search` command runs `grepai search … --json` against it, feeding matching snippets into the cleanup `<context>` so the model references actual files, classes, and functions by name. Repos without a `.grepai/` index are skipped, a 5-second timeout bounds the search, and any failure degrades gracefully to an empty scope so it never blocks the dictation.

### Fixed

- **VS Code — multi-line agent prompts are no longer submitted line-by-line:** When the structured Agent Instruction template produced a multi-line prompt, inserting it into an integrated-terminal TUI (Claude Code, Codex, a readline shell) sent each line separately — the first embedded newline fired Enter and submitted only `## Ziel` on its own. Multi-line terminal text is now wrapped in a bracketed paste (`ESC[200~ … ESC[201~`) so the whole block is delivered as a single paste; the one trailing Enter that submits it is added outside the markers. Single-line sends are unchanged.
- **VS Code — `## Scope` was silently empty (grepai output not parseable):** `grepaiProvider` invoked `grepai search` without `--json` and parsed the result as `file:line: content`, but grepai's default output is a formatted box that never matched — so the scope context was always empty. The provider now calls `grepai search … --json` and parses the JSON array (`file_path` / `content`), stripping grepai's redundant per-snippet `File: <path>` header.
- **Both hosts — `## Ziel` header is mandatory even for short commands:** A short, single-action instruction previously collapsed to a bare imperative line without the `## Ziel` header, breaking the structured contract (and the multi-line delivery that depends on it). The template now always emits the `## Ziel` header, even for a one-line command.
- **macOS — "Verarbeite mit Claude…" no longer stalls until a key press:** Even with App Nap disabled (0.7.0), a hidden window's WKWebView is still subject to the occlusion throttle, so a native command's IPC response could sit undelivered until an unrelated event (a hotkey press) woke the run loop — the flow froze at "Verarbeite mit Claude…". A native run-loop heartbeat now emits `verba:heartbeat` roughly every 200 ms while a dictation is in flight, waking the tao event loop so the IPC response reaches the WebView on its own.

### Security

- **Both hosts — grepai search hardened against argv flag injection:** The `grepai search` invocation now terminates its flags with `--` before the query, so a dictated query beginning with `-` can no longer be smuggled in as a CLI flag.

## [0.7.0](https://github.com/talent-factory/verba/compare/verba-v0.6.0...verba-v0.7.0) (2026-07-25)

### Added

- **macOS — Push-to-Talk activation (TF-525):** Alongside the `Ctrl+Alt+D` toggle, Verba now supports hold-to-talk via a native CGEvent tap: hold **right-Command** to dictate and **insert** the cleaned text, or **right-Option** to dictate and **submit** it (text plus an Enter into the target). Release delivers; a short tap never records. The event tap self-recovers if macOS disables it (timeout / user input).
- **macOS — Agent-native delivery into terminal agents (TF-525):** When a supported agent pane (e.g. a herdr-managed Claude Code session) is focused, Verba types the cleaned text straight into it — with the submit Enter for the right-Option intent — instead of the clipboard + synthetic ⌘V paste. The agent path needs **no Accessibility permission**; only the paste fallback does. A partial failure (text delivered but Enter not sent) is reported distinctly and never double-delivers.
- **macOS — Surface-aware template selection (TF-525):** Tiered surface detection (herdr context → `NSWorkspace` frontmost app → Accessibility window title) recognizes agent, terminal, and editor surfaces and auto-selects the 🦾 Agent Instruction template when an agent surface is focused, turning free-form speech into a crisp imperative command. Falls back to the active template on any surface it cannot classify.
- **macOS — Actionable HUD messages:** The non-activating HUD pill now also mirrors actionable outcomes — Secure-Input paste blocked (transcript left on the clipboard, press ⌘V), empty dictation (no speech detected), and delivery failure — so they are visible even though a menu-bar (Accessory) app cannot reliably raise system notification banners.

### Changed

- **Both hosts — the active template's output language now flows into cleanup:** A template's configured `outputLanguage` is passed through to the Claude cleanup context on both the VS Code extension and the macOS app, so a template that fixes its output language behaves identically on both surfaces.
- **VS Code Extension — Dictation shortcut moved to `Cmd+Alt+V` / `Ctrl+Alt+V`:** The start/stop dictation keybinding (`dictation.start` in the editor and `dictation.startFromTerminal` in the integrated terminal) moved off `Cmd+Shift+D` / `Ctrl+Shift+D`, which collides with VS Code's built-in **Run and Debug** view (`workbench.view.debug`). In the integrated terminal the built-in shortcut always won, so terminal dictation never triggered. `Cmd+Alt+V` avoids both that collision and the macOS **Dock hiding** system shortcut (`Cmd+Alt+D`). All VS Code docs and the quick-start shortcut table were updated; the continuous-dictation shortcut (`Cmd+Shift+Alt+D`) is unchanged.
- **VS Code Extension — Integrated-terminal dictation auto-selects the Agent Instruction template:** With `verba.autoSelectTemplate` (default `true`), dictating while the integrated terminal is focused now selects the 🦾 Agent Instruction template (transcript → a crisp imperative agent command). Unlike the macOS app — which disambiguates an agent surface via herdr / window-title detection — the VS Code host treats *any* focused integrated terminal as an agent surface, so a plain shell in which you dictate a shell command also receives the imperative treatment. Set `verba.autoSelectTemplate: false` to always keep your manually chosen template regardless of focus.
- **VS Code Extension — Template picker shows icons and marks the active template:** The `dictation.selectTemplate` Quick Pick (`Cmd+Alt+T`) now renders each template's emoji icon in the label (parity with the macOS tray) and tags the currently active (last-used) template with a clearly visible "aktiv" marker in the item description, so it reads distinctly from the icon column. Context-aware templates show a search hint in the same description instead of a leading label icon. The `icon` template field, previously honored only by the macOS tray, is now rendered by the VS Code picker as well.

### Fixed

- **macOS — recording no longer freezes at "Transcribing…"/"Processing…":** Once recording stopped, the menu-bar (Accessory) app — no longer visible nor capturing audio — was subject to macOS **App Nap**, which throttled the hidden main WebView's JavaScript event loop. The dictation flow (transcribe → cleanup → paste) runs in that WebView, so the native Rust command completed and returned, but its IPC response was not delivered to JavaScript until an unrelated event (e.g. a hotkey press) woke the run loop. The flow therefore stalled indefinitely at "Transcribing…" or "Processing…", and appeared to need a second hotkey press to finish. Instrumentation confirmed the native side always completed while the JavaScript `await` never resumed. Verba now holds an `NSActivityUserInitiatedAllowingIdleSystemSleep` process-activity token for its lifetime, which disables App Nap (and timer throttling) while still allowing normal idle system sleep. (An earlier attempt used `NSActivityBackground`, which does **not** disable App Nap — per Apple that is the discretionary/maintenance priority band App Nap is explicitly allowed to throttle — so the stall kept recurring intermittently until the flag was corrected.) Independently, the native capture thread now finalizes the WAV and reports its path **before** tearing down the cpal/CoreAudio stream (whose teardown can itself block for seconds), so `stop_capture` no longer waits on stream teardown; a 10-second timeout on the recording-stop step remains as a safety net.
- **macOS — a timed-out dictation now really stops the in-flight API request (TF-521):** The native `anthropic_fetch` (Claude cleanup) and `deepgram_transcribe` (transcription) commands run over a Tauri `invoke`, which cannot be cancelled once dispatched — so when the frontend's cleanup timeout fired mid-request, the underlying `reqwest` call kept running to its own 30-second timeout and still incurred the Anthropic/Deepgram cost for a result already discarded. A JS→Rust cancellation bridge now closes this: each request is registered under an id and races a `tokio_util` `CancellationToken`, and on abort the frontend fires a `cancel_request` command that cancels the in-flight call — for both Claude and Deepgram. A transcription timeout (symmetric to the existing cleanup timeout) was added so a stalled Deepgram request recovers to idle with an error instead of freezing at "Transcribing…".
- **macOS — Agent Instruction template no longer refuses non-actionable dictation:** When surface detection selected the 🦾 Agent Instruction template and the dictation contained no actionable task, the model would refuse with a meta-message (e.g. "I cannot convert this transcript… please provide a task that contains an actual instruction") — in English, regardless of the spoken language — and that refusal was pasted verbatim. The template prompt now specifies a graceful fallback: with no actionable instruction it returns the transcript lightly cleaned as plain prose in the original spoken language, consistent with Verba's principle of never discarding the user's words. Applies to both hosts (shared `@verba/core` default template, kept in lockstep by the parity test).
- **Cleanup — markdown code fences no longer leak into inserted text:** Claude often wraps code-oriented answers (JavaDoc, code comments, transformed selections) in ```` ```lang … ``` ```` fences, which were pasted literally into the editor. `@verba/core`'s `CleanupService` now strips a single outer code fence from the model output on both the streaming and non-streaming paths. Inner fences that are part of the content (e.g. a code block inside a Markdown answer) are preserved.
- **Packaging — VSIX no longer bundles the entire monorepo:** `.vscodeignore` now excludes `apps/**` (the multi-gigabyte Tauri macOS app with its build output), all nested `node_modules`, local tooling/state folders (`.headroom`, `.serena`, `.superpowers`, `.grepai`), and the local `.env`. Previously `vsce package` tried to pack `apps/macos` and hung indefinitely; the resulting VSIX is now ~1.7 MB (13 files).
- **Dev workflow — `npm run dev` now bundles before launching:** `npm run dev` (used by `just dev`) ran `npm run compile`, which builds `out/`, but the extension's `main` points at `dist/extension.js`, produced only by `npm run bundle`. As a result the Extension Development Host launched a stale bundle instead of current code. `npm run dev` now runs `npm run bundle` so the dev host always loads the latest build.

## [0.6.0](https://github.com/talent-factory/verba/compare/verba-v0.5.0...verba-v0.6.0) (2026-07-05)

### Added

- **VS Code Extension — Configurable Transcription Language (`verba.transcription.language`):** New setting to explicitly select the Deepgram transcription language — `multi` for multilingual auto-detection (default) or a fixed ISO code such as `de`, `en`, `fr`, `es`, `it`, `nl`, `pt`. This is a **backward-compatible optional override**: when it is not set, transcription continues to follow `verba.language` exactly as before. Changes apply live (no window reload needed). Closes the parity gap with the macOS app for users who dictate in a fixed language independent of their post-processing language.
- **macOS App — Native menu-bar dictation app (TF-518):** The macOS build ships as a standalone Tauri menu-bar app with the full dictation flow — record → Deepgram Nova-3 transcription → Claude post-processing → paste into the frontmost application — triggered by a global hotkey (Ctrl+Alt+D). Includes:
  - **Clipboard paste mechanism:** pastes via the clipboard plus a synthetic ⌘V, saving and restoring the user's previous clipboard text.
  - **API keys from the environment:** keys resolve ENV → Keychain → GUI prompt, so a shell-launched build needs no prompt; the native `env_var` command is allowlisted to the Verba/Deepgram/Anthropic key names.
  - **JSON configuration** at `~/.config/verba/config.json` (XDG-aware), with defensive defaults — a missing or malformed file falls back to defaults rather than failing.
  - **Working-state visualization:** tray-icon states (idle / recording / transcribing / processing) plus a focus-safe, click-through HUD pill that never steals focus from the target application.
  - **Settings UI** via tray submenus (transcription language, cleanup language, provider, and active template) that write the config and apply on the next dictation without a restart.
  - **Post-processing templates** shipped as config data (the nine built-in templates), with an active-template selector persisted to the config; user overrides via a `templates` array in `config.json`.

### Changed

- **Shared configuration schema in `@verba/core`:** Configuration resolution — defaults, type validation, and active-template selection — is now defined once in the platform-agnostic `@verba/core` package and consumed by **both** the VS Code extension and the macOS app through a common `ConfigProvider` adapter. Behaviour for valid settings is unchanged, and `verba.glossary`, `verba.expansions`, and `verba.templates` are now portable between the two hosts (identical validation on both). The scattered `getConfiguration('verba')` reads in the extension, and the macOS app's own resolver, now go through this single source; the macOS tray reads the same canonical default templates.
- **VS Code Extension — Stricter template validation (all-or-nothing):** If any entry in `verba.templates` is malformed — missing a non-empty `name` or a string `prompt` — the extension now falls back to the complete set of built-in default templates instead of silently loading only the valid entries. This prevents a partially-broken template menu and matches the macOS app. A parity test keeps the built-in template defaults in `package.json` in lockstep with the canonical set shipped by `@verba/core`.
- **Glossary/expansion settings validated per entry (both hosts):** `verba.glossary` and `verba.expansions` are validated element by element in the shared schema — invalid entries are dropped while valid ones are kept, and empty/whitespace-only glossary terms are ignored. A single malformed entry never discards the whole list.

### Fixed

- **macOS App — Transcription language mis-detection:** removed the contradictory `detect_language=true` that was sent alongside `language=multi`, which caused some German dictation to be transcribed as Dutch. The transcription language is now configurable and defaults to multilingual mode.
- **macOS App — Invalid environment API key no longer dead-ends:** when a Deepgram key sourced from an environment variable is rejected, Verba now shows a distinct, actionable message (correct or unset the variable) instead of silently re-prompting in an unrecoverable loop.
- **macOS App — Silent failures surfaced:** a failed global-hotkey registration, a malformed `config.json`, and a failed tray settings write now raise a native notification instead of only writing to a hidden window or stderr (invisible on a menu-bar app).
- **macOS App — Clipboard restore on paste failure:** the previous clipboard is now restored even when the synthetic ⌘V fails, so a failed paste no longer leaves the transcript stranded on the clipboard with the user's prior content lost.

## [0.5.0](https://github.com/talent-factory/verba/compare/verba-v0.4.0...verba-v0.5.0) (2026-03-04)

### Added

- **Undo Last Dictation (TF-258):** `dictation.undo` command (`Cmd+Z` context-aware) reverts the last dictation insertion. Works in both editor (via document edit reversal) and terminal (via backspace sequence). Single-level undo with automatic expiry after new edits.
- **Dictation History with Full-Text Search (TF-264):** Persistent dictation history stored via `globalState`. Browse recent dictations via Quick Pick (`dictation.showHistory`), search across raw transcript and cleaned text (`dictation.searchHistory`). Actions: insert at cursor, copy to clipboard, show details. Configurable max entries (`verba.history.maxEntries`, default 500). Privacy: history stays local, never sent to APIs.
- **Continuous Dictation with Deepgram Streaming (TF-260):** Longer dictation sessions using Deepgram Nova-3 WebSocket streaming. ffmpeg captures microphone audio (raw PCM to stdout), piped directly to Deepgram's real-time transcription API. Deepgram's built-in VAD handles pause detection and utterance segmentation. Each completed utterance goes through Claude cleanup, then insertion. New command `dictation.startContinuous` (`Cmd+Shift+Alt+D`). Per-utterance undo and history records.
- **Multi-Language Auto-Detection (TF-261):** Deepgram `language: 'multi'` enables automatic language detection for both single-shot and continuous transcription. Detected language is passed through to Claude post-processing for language-appropriate cleanup. Manual override via `verba.language` setting.
- **Retry Logic for API Overload (TF-273):** Exponential backoff with up to 3 retries when Claude API returns HTTP 529 (overloaded). Backoff delays: 2s, 4s, 8s. Prevents dictation loss during transient API capacity issues.

### Changed

- **Deepgram Consolidation (TF-272):** Replaced OpenAI Whisper API with Deepgram Nova-3 pre-recorded API for single-shot dictation. Both single-shot and continuous now use Deepgram (shared API key). `openai` npm package retained for embeddings only. Cost reduced from $0.006/min (Whisper) to $0.0043/min (Deepgram Nova-3).
- Deepgram keyterm token limit reduced to prevent request failures with large glossaries
- Language configuration passed through from transcription service to Deepgram API

### Fixed

- API key deletion now checks for HTTP 401/403 status codes instead of deleting on any transcription error
- Undo records cleared correctly after new editor edits to prevent stale undo operations
- History persistence errors handled gracefully without disrupting the dictation pipeline
- Resource leak fixed when continuous recorder fails to start (status bar listener now disposed)
- Unreachable auth-detection code removed from continuous segment error handler
- Duplicate `historyManager` import statements removed

## [0.4.0] - 2026-03-02

### Added

- **API Key Management:** `dictation.manageApiKeys` command to view (masked), update, or delete stored OpenAI and Anthropic API keys via the Command Palette.
- **LLM Cost Tracking & Overview (TF-270):** `dictation.showCostOverview` command opens a WebView panel showing per-model API usage costs. Tracks Whisper transcription (by audio duration), Claude processing (by input/output tokens), and OpenAI Embeddings (by prompt tokens). Costs displayed per session and accumulated across all sessions, grouped by provider (OpenAI / Anthropic) in a card layout with VS Code theme support. Total costs reset automatically on the 1st of each month; older records are retained in storage.
- **Adaptive Personal Dictionary (TF-263):** `dictation.generateGlossary` command scans workspace for project-specific terms (package names, class/interface/function names, README/CLAUDE.md headings and bold terms). Users review suggestions via Multi-Select Quick Pick before merging into `.verba-glossary.json`. Supports TypeScript, Java, and Python projects.
- **Multi-Cursor / Selection-aware Dictation (TF-265):** Dictation now respects editor selections and multi-cursors. When text is selected, the dictated output replaces the selection; with multi-cursors, text is inserted at all cursor positions simultaneously. Selected text is passed as context to Claude post-processing via `<selection>` tags. New "Transform Selection" default template for voice-driven text transformation (e.g. translate, refactor, explain).
- **Text Expansion / Abbreviations (TF-262):** User-defined abbreviations that are automatically expanded during post-processing. Configure via `verba.expansions` setting (e.g. `"mfg"` → `"Mit freundlichen Grüssen"`) or workspace-specific `.verba-expansions.json`. Global and workspace expansions are merged, with workspace entries taking precedence for the same abbreviation.
- **File-Type-Aware Templates (TF-259):** Templates can now define a `fileTypes` array with VS Code language IDs (e.g. `["java", "kotlin"]`). When `verba.autoSelectTemplate` is enabled (default), the template matching the active editor's file type is automatically selected. Falls back to the last manually chosen template when no match is found. Built-in defaults: JavaDoc → java/kotlin, Markdown → markdown.

### Changed

- Release automation migrated from manual workflow to release-please for automatic versioning, changelog generation, and GitHub Releases

## [0.3.0] - 2026-02-26

### Added

- **Offline Transcription (TF-257):** Local transcription via whisper.cpp CLI as an alternative to OpenAI Whisper API. Audio never leaves the machine. Strategy pattern on `TranscriptionService` with `setProvider('openai'|'local')`.
- **Model Download:** GGML models from Hugging Face via `dictation.downloadModel` command with progress indicator and cancellation support. Model selection: tiny, base, small, medium, large.
- **Provider Display in Status Bar:** Tooltip shows active provider (OpenAI Whisper / Local whisper.cpp), transcribing state displays provider explicitly.
- **Streaming Post-Processing:** Claude responses are received via streaming with real-time progress display in the status bar (e.g. "Processing... 182 chars"). Dictation can be cancelled during processing by pressing the shortcut again.
- **Course Correction:** Self-corrections in dictation are automatically detected and removed (e.g. "no wait, actually Friday" → "Friday"). Active in all modes (freeform and templates).
- **Voice Commands:** Spoken formatting commands are recognized and applied (e.g. "New paragraph", "Period", "Bullet point"). Works language-independently in all modes.
- **Glossary/Dictionary:** Terms (product names, technical terms, abbreviations) are preserved exactly during transcription and cleanup. Global terms via `verba.glossary` setting, project-specific via `.verba-glossary.json`.
- **JSDoc Documentation:** All public APIs across 13 source files documented.

### Fixed

- SIGKILL escalation for hanging whisper-cli processes
- Provider validation with fallback for invalid settings
- Minimum file size check after model download

### Changed

- Marketplace homepage link updated to `talent-factory.xyz`
- Marketplace category changed from `Other` to `Snippets`

## [0.2.0] - 2026-02-24

### Added

- **Configurable Prompt Templates (TF-248):** 5 default templates (Freeform, Commit Message, JavaDoc, Markdown, Email) with full customization via `verba.templates` setting
- Context-Aware Dictation with semantic code search via grepai or OpenAI Embeddings
- 3 context-aware templates: Code Comment, Explain Code, Claude Code Prompt
- `dictation.indexProject` command to build a local embeddings index for context search
- `verba.contextSearch.provider` setting (`auto`, `grepai`, `openai`) and `verba.contextSearch.maxResults` setting
- GitHub Actions changelog preview workflow: posts a categorized changelog preview as a PR comment when opening PRs to `main`
- Template Quick-Pick selection menu integrated into dictation workflow
- Template auto-reuse: last used template is automatically reused, Quick Pick only on first use
- `dictation.selectTemplate` command (`Cmd+Alt+T` / `Ctrl+Alt+T`) to change template without starting a recording
- Status bar shows active template name in idle state
- Pipeline context architecture for dynamic system prompt passing to Claude
- **Cross-Platform Audio Device Selection:** macOS (AVFoundation), Linux (PulseAudio), Windows (DirectShow)
- `dictation.selectAudioDevice` command for microphone selection on any platform
- `verba.audioDevice` setting for manual microphone configuration
- Windows-specific ffmpeg search paths (Chocolatey, Scoop, WinGet, Program Files)
- PowerShell fallback (`Win32_SoundDevice`) when ffmpeg finds no Windows audio devices
- **Marketplace Publishing:** extension icon (SVG/PNG), screenshots, workflow GIF
- Open-source governance files: MIT License, Code of Conduct, Security Policy
- Semantic-release configuration with emoji-aware conventional commit parsing
- GitHub Actions release workflow for automated versioning on merge to `main`

### Fixed

- Template shortcut changed from `Cmd+Shift+T` to `Cmd+Alt+T` to avoid conflict with VS Code's built-in shortcut
- CHANGELOG.md included in VSIX package for the Marketplace Changelog tab
- Git identity configured for GitHub Actions release commits (`github-actions[bot]`)
- Extension bundled with esbuild to fix activation failure
- Transcript wrapped in XML tags to prevent Claude generating conversational responses instead of clean output
- Terminal focus detection rewritten with two separate commands and mutually exclusive `when` clauses
- Template prompt wrapped with framing context for reliable output format
- Windows audio recording: robust device detection supporting both ffmpeg v7 (section-based) and v8+ (inline `(audio)`) output formats
- Audio device selection enabled for macOS and Linux (previously only Windows)
- `make dev` workflow compatible with Windows/Cygwin
- `install:local` npm script now works cross-platform

## [0.1.1] - 2026-02-20

### Added

- Terminal dictation: `dictation.startFromTerminal` command inserts dictated text into the active terminal
- `verba.terminal.executeCommand` setting to auto-execute dictated text as a terminal command
- Shared keybinding `Cmd+Shift+D` / `Ctrl+Shift+D` with context-aware routing (terminal vs editor)
- Whisper silence/hallucination detection (recordings with only dots/ellipsis are rejected)
- Debug logging throughout the transcription and cleanup pipeline
