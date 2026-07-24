# Agent-Instruction Cleanup — Design

**Date:** 2026-07-22
**Status:** Design (approved for planning)
**Surfaces:** `@verba/core` (transformation) · VS Code host · macOS host
**Linear:** _(to be created — sub-issue candidate under TF-243 / TF-518)_

## Context & Positioning

Verba's competitive landscape (2026) is a crowded field of "AI voice keyboards"
— Wispr Flow, Superwhisper, Voibe, VoiceInk, Spokenly — all of which optimize
their post-processing for **prose**: grammar, filler removal, emails, Slack. On
that surface (system-wide dictation into any app) Verba is a build-from-source
Beta and cannot win a distribution war.

The defensible USP is a different category:

> **Verba is the voice layer for developers who command AI agents — not the
> dictation app for people who write prose.**

The signal is the maintainer's own workflow shift: away from the IDE as the
primary tool, toward terminal-native agent multiplexers (e.g. `herdr`, running a
herd of Claude Code / Codex / Cursor agents in PTY panes). Talking to a herd of
agents — high-throughput, natural-language, hands-busy — is exactly where voice
beats typing.

No competitor tunes its cleanup for agent **instructions** (imperative,
structured, file references, acceptance criteria) rather than prose. That is the
open flank, and Verba already has the bones: the "Claude Code Prompt" template,
`<selection>` context, code-aware cleanup, and the glossary. The closest
competitor to watch is **Spokenly** (MCP integration), not Wispr Flow.

This spec defines the **first wedge**: an adaptive agent-instruction cleanup mode
in `@verba/core`, with context-based activation across both hosts.

## Goals

1. A new cleanup mode/template that transforms a spoken thought into a clean,
   executable **agent instruction** rather than polished prose.
2. **Adaptive structure**: short/simple utterances stay terse commands;
   long/multi-part utterances become structured (task + constraints).
3. **Context-based activation**: Verba detects when the dictation target is an
   agent surface (a terminal running an agent, in particular a `herdr` pane) and
   selects this mode automatically, with graceful degradation and a manual
   override.
4. Shared, surface-agnostic implementation in `@verba/core` so both hosts
   benefit identically.

## Non-Goals (YAGNI in v1)

- ❌ **Per-agent tuning.** A good Claude Code prompt is a good Cursor/Codex
  prompt. One agent-agnostic mode; no per-agent prompt variants.
- ❌ **Targeted pane routing.** v1 still delivers via the existing insertion path
  (VS Code editor/terminal insert; macOS clipboard + synthetic ⌘V). Sending the
  cleaned instruction *directly* to a specific `HERDR_PANE_ID` via the herdr
  socket is a **fast-follow** (see Rollout), even though detection already talks
  to that socket.
- ❌ **Process-tree inspection** as the detection primitive (breaks over SSH — see
  Surface Detection).
- ❌ **Turning Verba into a general environment reader** — the `env.rs` allowlist
  precedent stands.

## The Transformation (core, `@verba/core`)

A new template `Agent Instruction` added to
`packages/core/src/config/defaultTemplates.json` (the single canonical source
for both hosts, loaded via `DEFAULT_TEMPLATES` in `packages/core/src/config.ts`).
Its `prompt` framing is built and applied through the existing `CleanupService`,
so it inherits glossary, expansions, course-correction, and voice-command
handling for free. What changes is the **framing target**, not the pipeline.

The framing instructs the model to:

- **Extract the instruction, drop the meta-speech.** "Okay so what I want you to
  do is…" → the instruction itself.
- **Imperative and unambiguous.** "I think maybe we could look at…" → "Do X."
- **Adaptive structure by complexity** (the make-or-break behavior):
  - Short/single-action utterance → a terse imperative line.
  - Long/multi-part utterance → a structured block: task, then bulleted
    details, then an explicit `Constraints:` / "do not touch" section when the
    speaker names boundaries.
- **Preserve code references** — file paths and symbols in backticks (the
  glossary already protects technical terms).

### Adaptive structure — worked examples

Short:
> 🎙️ "okay run the migration and then the tests"
> → `Run the migration, then run the tests.`

Long / rambling:
> 🎙️ "so I want a caching layer in the user service, uh, should use redis,
> invalidate on write, and yeah — don't touch the auth please"
> →
> ```
> Add a caching layer to the user service.
> - Use Redis.
> - Invalidate on write.
> Constraints: do not modify the auth code.
> ```

Over-formatting is the field-reported #1 annoyance for these tools; a terse
command must **not** be inflated into a five-section task block. The complexity
decision is made by the model inside a single prompt (no user-facing toggle).

## Surface Detection (tiered)

Rather than guessing "which app," Verba classifies the **target surface** into
three classes and maps each to a cleanup:

| Target surface        | Cleanup           | Signal                                              |
|-----------------------|-------------------|-----------------------------------------------------|
| **Terminal / Agent**  | Agent Instruction | tiered detection (below)                            |
| **Code editor / file**| File-type template| existing `languageId` path (TF-259, `findTemplateForLanguage`) |
| **Other** (Slack, mail, browser) | Prose default | fallback                                 |

Detection of the Terminal/Agent class runs in **tiers**, best → floor. A higher
tier can only make detection *more* precise; it never degrades below the floor,
so a focused terminal never misfires to prose.

| Tier | Signal | Applies to | Quality |
|------|--------|-----------|---------|
| **1 · Cooperative** | herdr socket at `HERDR_SOCKET_PATH` (well-known `~/.config/herdr/herdr.sock`) reports an active pane | herdr panes | deterministic, survives SSH-attach via the local socket bridge |
| **2 · Marker** | focused-terminal window title / shell command matches a configurable marker list (`claude`, `herdr`, `codex`, `aider`, `cursor`, …) | standalone agents without herdr | heuristic |
| **3 · App class** | frontmost app is a known terminal (bundle-ID list) | any other terminal | coarse floor |

**Why title/socket, not process-tree:** the maintainer runs `herdr` over SSH, so
the agent process lives on a remote box. A local `ps`/`pgrep` child-process scan
finds only `ssh`. A window **title** is propagated through the SSH TTY; the herdr
**socket** is a local bridge. Both survive SSH; process-tree inspection does not.

### Per-host mechanism

- **VS Code host** — reuse the existing terminal-focus signal (the
  `dictation.startFromTerminal` path already distinguishes terminal focus). Tier 2
  reads the current command via the terminal shell-integration API
  (`Terminal.shellIntegration`), falling back to the terminal name. Editor focus
  keeps the current file-type template behavior unchanged.
- **macOS host** — **new** code (today `paste.rs` fires a blind ⌘V and does not
  read the frontmost app):
  - Tier 3: frontmost app via NSWorkspace → bundle-ID classification (Terminal,
    iTerm2, Ghostty, WezTerm, kitty, Alacritty, Warp, …).
  - Tier 2: focused-window title via the Accessibility API (permission already
    granted for paste).
  - Tier 1: check whether `HERDR_SOCKET_PATH`'s socket exists; if so, query
    herdr for the active pane. This respects the `env.rs` security posture — we
    talk to the cooperating tool's socket, we do **not** read arbitrary process
    environments.

### Activation rules

- `agent` → `Agent Instruction` template; `editor` → existing file-type
  auto-select; `generic` → prose default.
- **Manual template selection always overrides** the auto-detection for the next
  dictation (the safety valve).

## Configuration & UX

- New bundled template `Agent Instruction` in `defaultTemplates.json` (with an
  `icon` for the macOS tray; `contextAware: true` since it benefits from
  `<selection>`/editor context where available). Templates remain all-or-nothing
  per `resolveConfig` (one invalid entry → the 9→10 bundled defaults).
- New config for the marker list and terminal/editor app classes — macOS uses
  bare top-level keys (no `verba.` prefix), matching the schema in `config.ts`;
  extensible like `glossary`/`expansions`.
- Manual selection via the existing pickers (VS Code `dictation.selectTemplate`;
  macOS tray submenu in `menu.rs`).

## Language handling

The maintainer dictates in German but the codebase and commits are English. The
mode respects the existing cleanup-language setting (`resolveConfig.language`),
**plus** an optional per-mode "always English" fixation so a German utterance
yields a clean English instruction. Default: follow the existing setting; the
fixation is opt-in.

## Integration points (real symbols)

- `packages/core/src/config/defaultTemplates.json` — new template entry.
- `packages/core/src/config.ts` — `Template`, `DEFAULT_TEMPLATES`,
  `resolveConfig`, `resolveActiveTemplate`; new config fields for marker/app lists.
- `packages/core/src/cleanupService.ts` — framing applied through the existing
  service; a shared `AGENT_INSTRUCTION_INSTRUCTION` constant analogous to the
  existing `COURSE_CORRECTION_INSTRUCTION` / `VOICE_COMMANDS_INSTRUCTION`.
- VS Code: `src/templatePicker.ts` (`findTemplateForLanguage`, `autoSelectTemplate`)
  extended with the surface-class decision; terminal-focus reuse from the
  `dictation.startFromTerminal` path.
- macOS: new focus/title/socket detection module on the Rust side (sibling to
  `paste.rs`); wired through `apps/macos/src/controller.ts` /
  `apps/macos/src/wiring.ts` so the controller stays `@tauri-apps/api`-free and
  testable.

## Open assumptions to verify (during planning)

1. **herdr socket API** actually exposes "which pane is active" (Tier 1) — and,
   for the fast-follow, "send input to pane X". Verify against herdr's CLI/socket
   docs (a `herdr` control skill is available). If unavailable, Tier 1 degrades
   to Tier 2/3 with no loss of the v1 floor.
2. **Shell-integration command visibility** in the VS Code integrated terminal is
   reliable enough for Tier 2; otherwise fall back to terminal name.
3. **AX window-title read** returns the foreground command for the common
   terminals in the maintainer's setup.

## Testing

- **Transformation** (`@verba/core`): table tests over language pairs — short →
  terse, long → structured, boundary cases; assert no over-formatting of short
  commands and correct `Constraints:` extraction on long ones.
- **Stall path** (memory: `project_core_rebuild_stale_dist` sibling lesson — test
  the freeze, not just the throw): exercise the cleanup fallback with a
  never-resolving promise + timeout, since a hang is its own failure mode
  ("Verarbeite mit Claude" freeze).
- **Detection**: unit-test the tier resolution with injected signals (socket
  present/absent, title with/without markers, frontmost bundle-ID) and assert the
  floor behavior (terminal focused + opaque title → still `agent`, never prose).
- **Manual override** wins over auto-detection.

## Rollout / phasing

- **v1** — this spec: adaptive `Agent Instruction` cleanup + tiered surface
  detection (incl. the herdr socket for detecting the active pane). Delivery stays
  on the existing insertion path (⌘V on macOS).
- **Fast-follow** — targeted routing: deliver the cleaned instruction directly to
  the active `HERDR_PANE_ID` via the herdr socket instead of a blind ⌘V. The v1
  detection work already establishes the socket conversation, making this cheap.
- **Later** — process/title marker refinements for more standalone agents;
  optional promotion of `Agent Instruction` to the default cleanup if the
  maintainer's workflow becomes agent-dominant.
