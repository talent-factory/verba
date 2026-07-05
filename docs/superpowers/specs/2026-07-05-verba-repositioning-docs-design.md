# Verba Repositioning — Documentation Overhaul (Design)

**Date:** 2026-07-05
**Status:** Approved design, ready for implementation plan
**Scope:** `README.md`, `CLAUDE.md`, `docs/**` (mkdocs site), plus positioning
metadata (`package.json`, `mkdocs.yml`) and the stale `apps/macos/README.md`.
**Non-scope:** Product/code changes, a macOS distributable build (`.dmg`),
CHANGELOG entries, marketing site.

---

## 1. Motivation

Verba began as "The Developer's Dictation Extension" — a VS Code–only tool.
The codebase has since become a **monorepo with a shared core and two hosts**:

- `@verba/core` (`packages/core`) — platform-agnostic dictation logic
  (pipeline, cleanup, Deepgram provider, config schema, adapter contracts).
- **VS Code extension** (repo root) — the shipped flagship (v0.5.0, Marketplace).
- **macOS app** (`apps/macos`, Tauri) — a system-wide menu-bar dictation tool:
  global hotkey → mic capture → native Deepgram transcription → Claude cleanup →
  **paste into the frontmost app**, plus tray config, templates, glossary,
  expansions, language, and a HUD visualization.

The macOS app moves Verba out of the editor and onto the whole OS — the same
territory as system-wide dictation tools (Wispr Flow, Superwhisper, …). The
documentation still describes a VS Code–only product and must be repositioned.

**Reality checks that constrain the docs:**

- The macOS app is functionally advanced but has **no distributable build** and
  no CI packaging — it runs only via `just macos-dev`. It must be presented as
  **Public Beta**, installable via *build from source* only.
- `apps/macos/README.md` claims "M3 in progress — paste still open." This is
  **stale**: paste, config, templates, settings UI, and visualization all ship.

## 2. Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | macOS maturity framing | **Public Beta / Preview** — equal surface, clearly marked Beta, build-from-source, distribution "coming" |
| D2 | Positioning direction | **Keep developer DNA, extend reach** — "Extension" → "Tool"; system-wide on macOS *and* deep in VS Code |
| D3 | docs/ restructure depth | **Full restructure** into two surfaces (VS Code + macOS Beta) with shared Concepts strand |
| D4 | Competitor positioning | **"Why Verba"** differentiators, **no** named competitors |
| D5 | Approach | **A — one coordinated pass** across all three surfaces |
| D6 | Commit granularity | **One commit per wave**, all via `/git-workflow:commit` (no manual commits) |
| D7 | CHANGELOG | **No entry** — docs/positioning changes are not shipped extension changes |

## 3. Positioning & Canonical Copy

**Umbrella positioning (the one-liner used across README, docs Home, metadata):**

> **Verba — developer-grade voice dictation, everywhere you type.**
> Speak instead of type. Verba records your voice, transcribes it with
> **Deepgram Nova-3**, and refines it with **Claude** — **system-wide across
> macOS (Beta)** or **deep inside VS Code**. Bring your own keys, keep your data.

**Per-surface one-liners:**

- **VS Code extension** (shipped flagship): *"Dictate into your editor and
  terminal, with code-aware AI templates."*
- **macOS app (Beta):** *"System-wide dictation into any app — press a hotkey,
  speak, and Verba pastes clean text wherever your cursor is."*

**Why Verba — differentiators (no competitor names):**

1. **Bring Your Own Key** — your own Deepgram + Anthropic keys; no subscription.
2. **Privacy & data control** — keys in the OS keystore; optional fully offline
   transcription (whisper.cpp); your audio/text never routed through us.
3. **Developer- & code-aware** — code-aware templates, Claude Code prompt
   generation, commit messages, JavaDoc, and deep VS Code integration.
4. **Everywhere** — the same dictation intelligence in your editor *and*
   across your whole Mac.

**USPs (updated from the VS Code–exclusive framing):** Native integration
(editor *and* OS-wide) · developer- & code-aware templates · Bring-Your-Own-Key
/ privacy.

**Metadata to update to the umbrella framing:**

- `mkdocs.yml` → `site_description`
- **root** `package.json` → `description` (the VS Code / Marketplace manifest;
  kept Marketplace-friendly, but drop the "…for VS Code / developers-only"
  narrowing). `apps/macos/package.json` and `packages/core/package.json`
  descriptions are out of scope.
- README badges: keep Marketplace version/installs (VS Code), add a Platform
  badge and a discreet `macOS app: Beta` badge. **No** "Download .dmg."

## 4. README.md Structure

Replace the flat, VS Code–only feature list with a product-level structure:

```
1. Header — title + umbrella tagline + badges (Marketplace, Platform, macOS: Beta, MIT)
2. Hero paragraph — what Verba does; two surfaces in one sentence
3. Why Verba — differentiators (§3), no competitor names
4. Two ways to use Verba
     ▸ VS Code Extension (shipped) — 1-line pitch + Marketplace install + docs link
     ▸ macOS App (Beta) — 1-line pitch + build-from-source + docs link + Beta note
5. Features — regrouped (largest structural change):
     Core dictation intelligence (both): streaming cleanup, course correction,
       voice commands, glossary, text expansions, prompt templates
     VS Code: editor/terminal insert, multi-cursor/selection, history & search,
       continuous dictation, offline (whisper.cpp), file-type templates
     macOS (Beta): system-wide hotkey, paste into frontmost app, menu-bar config
       + templates, HUD visualization, Keychain
6. Prerequisites — ffmpeg, Deepgram key, Anthropic key (mostly shared)
7. Get started — brief per surface, details linked to docs
8. Configuration — short + link (settings.json vs ~/.config/verba/config.json)
9. Architecture — short: monorepo @verba/core + two hosts (diagram) + docs link
10. Contributing · Documentation · License
```

**Notes:**

- **macOS screenshot placeholder.** The VS Code `dictation-workflow.gif` stays.
  There is no macOS image yet and it cannot be generated here — insert a clearly
  marked placeholder/TODO for the user to fill later.
- Config paths shown correctly per surface: VS Code `settings.json` /
  `.verba-*.json`; macOS `~/.config/verba/config.json` (XDG).

## 5. CLAUDE.md Changes

CLAUDE.md is agent guidance and is currently VS Code–centric. Update to the
monorepo reality without diluting its purpose:

- **Project** — product with **two surfaces** on shared `@verba/core`; umbrella
  tagline. Repo/Linear links unchanged.
- **Tech Stack** — add Tauri/Rust (macOS); add monorepo (npm workspaces:
  `packages/core` · `apps/macos` · root = VS Code extension).
- **USPs** — OS-wide *and* editor (not "VS Code–exclusive").
- **Implementation Phases** — keep the existing (VS Code) list; add a new
  **"macOS App (Tauri, Beta)"** section: tray app, global hotkey, native cpal
  capture, native Deepgram (WebView constraint), Accessibility paste, config
  system (`~/.config/verba`), templates, settings UI, HUD visualization.
- **Monorepo Layout** (new) — map of root / `packages/core` / `apps/macos`, and:
  *"Hosts import `@verba/core` from `dist/`, not `src/`."*
- **Conventions** — add macOS conventions: config path `~/.config/verba/config.json`
  (XDG); hotkey `Ctrl+Alt+D`; templates all-or-nothing; `just macos-dev` builds
  core first. Existing commit convention stays.
- **Architecture** — split into three parts: (a) monorepo/build overview,
  (b) VS Code module table (existing, retitled "VS Code host"), (c) macOS module
  table (`apps/macos/src/*` + `src-tauri/*`).
- **Git/Release** — unchanged; note explicitly that release-please versions the
  **VS Code extension only** — the Beta macOS app has no release path yet.

**Two operational gotchas to anchor permanently** (they cost real debugging time
this session):

1. *After changes to `packages/core/src/**`, run `npm run compile:core` — hosts
   load `dist/`, not `src/`.* (A stale dist manifests as e.g. a dead macOS hotkey
   with no notification.)
2. *macOS config schema uses top-level bare keys* (`language`, `glossary`,
   `expansions`, `templates`, `activeTemplate`, …) — **no** `verba.` prefix; a
   VS Code–style `verba.language` key is silently ignored.

## 6. docs/ Information Architecture

Principle: document the **shared dictation intelligence once** under "Core
Features" (matching `@verba/core`); keep the two surface strands focused on
setup/usage + surface-specific config. No duplication.

**New nav (mkdocs.yml):**

```
Home                          index.md                        [REWRITE: product overview, Why-Verba teaser, surface choice]
Getting Started
  Choose your surface         getting-started/choose-surface.md   [NEW, small]
  Prerequisites               getting-started/prerequisites.md    [NEW: ffmpeg + keys, extracted from installation.md]
Core Features (shared)                                        [NEW strand — @verba/core]
  How Verba works             concepts/how-it-works.md        [NEW: pipeline record→transcribe→post-process]
  Prompt Templates            concepts/templates.md           [MOVE guide/templates.md, extended with both syntaxes]
  Glossary & Dictionary       concepts/glossary.md            [NEW]
  Text Expansions             concepts/expansions.md          [NEW]
  Voice Commands & Course Corr. concepts/voice-commands.md    [NEW]
  Bring Your Own Key & Privacy concepts/byok.md               [NEW]
VS Code Extension
  Installation                vscode/installation.md          [MOVE getting-started/installation.md, VS Code part]
  Quick Start                 vscode/quickstart.md            [MOVE getting-started/quickstart.md]
  Editor & Terminal           vscode/editor-terminal.md       [MOVE guide/terminal.md]
  Claude Code Integration     vscode/claude-code.md           [MOVE guide/claude-code.md]
  Offline Transcription       vscode/offline.md               [NEW: whisper.cpp — currently undocumented]
  Dictation History           vscode/history.md               [NEW: history/search — currently undocumented]
  Configuration               vscode/configuration.md         [MOVE guide/configuration.md]
macOS App (Beta)                                              [COMPLETELY NEW strand]
  Overview & Status           macos/overview.md               [NEW + Beta banner]
  Installation (build from source) macos/installation.md      [NEW: just macos-dev, Rust/Tauri prereqs]
  Usage                       macos/usage.md                  [NEW: menu bar, hotkey Ctrl+Alt+D, paste]
  Configuration               macos/configuration.md          [NEW: ~/.config/verba/config.json, tray menu]
  Permissions                 macos/permissions.md            [NEW: Accessibility + Microphone/TCC]
Development
  Architecture                development/architecture.md     [REWRITE: monorepo + core + two hosts]
  Cross-Platform Strategy     development/cross-platform-strategy.md   [keep]
  macOS App Internals         development/macos-internals.md   [RENAME from phase-1-macos-app.md]
  ADR – Deepgram Migration    development/adr-deepgram-migration.md    [keep]
  Contributing                development/contributing.md      [light update: monorepo setup]
Changelog                     changelog.md                    [keep]
```

**IA notes:**

- ~11 new + ~7 moved/rewritten pages. Volume is real → sequenced in waves (§7)
  so the site always builds.
- **Link & snippet integrity:** moving pages breaks relative links (from
  `apps/macos/README.md`, `mkdocs.yml`, cross-refs, `pymdownx.snippets`). Verify
  with `mkdocs build --strict` after each wave.
- **`--strict` pitfall:** `docs/superpowers/` (specs/plans, incl. this doc) is
  not in the nav. Add it to `exclude_docs` if strict build flags "not in nav."
- **No thin pages:** if `concepts/glossary.md` and `concepts/expansions.md`
  prove too short, merge into one "Glossary & Expansions" page. Decide at
  writing time by content volume, not upfront.

## 7. Execution Plan (waves)

Sequenced so the mkdocs site stays buildable after every wave. **One commit per
wave**, all via `/git-workflow:commit`.

```
Wave 0 — Positioning primitives & metadata
  · Lock canonical copy (umbrella tagline, Why-Verba differentiators)
  · package.json description · mkdocs.yml site_description · badges
  · Fix stale apps/macos/README.md status section
Wave 1 — README.md            (structure §4)
Wave 2 — CLAUDE.md            (§5)
Wave 3 — docs scaffold: Home + nav + moves
  · index.md rewrite · mkdocs.yml nav to new tree
  · git mv existing pages into vscode/ · concepts/ · development/
  · fix all relative links
  → GATE: `mkdocs build --strict` green BEFORE new content
Wave 4 — macOS strand         (overview, installation, usage, configuration, permissions)
Wave 5 — Concepts strand      (how-it-works, templates+, glossary, expansions, voice-commands, byok)
Wave 6 — VS Code refocus      (new: offline, history; reframe moved pages)
Wave 7 — Development          (architecture rewrite, macos-internals rename, contributing)
Wave 8 — Final verification   (`mkdocs build --strict` green, link check, `just compile`/typecheck unaffected)
```

**Per-wave verification:** `mkdocs build --strict` must stay green (mandatory
after moves, before new content).

## 8. Out of Scope / Non-Goals

- No macOS distributable build (`.dmg`), signing, or CI packaging.
- No product/code changes (docs only; canonical copy may be reused in code
  metadata strings such as `package.json` description).
- No CHANGELOG entry (D7).
- No named-competitor comparison table (D4).
- No marketing/landing site.

## 9. Open Items

- **macOS screenshot/GIF** — placeholder in README + `macos/overview.md`; the
  user supplies the real asset later.
- **Marketplace `package.json` description** — keep within Marketplace length
  norms while adopting the umbrella framing; final wording confirmed in Wave 0.
