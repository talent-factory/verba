# Verba Repositioning — Documentation Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition Verba's documentation (README, CLAUDE.md, mkdocs site) from a VS Code–only "Developer's Dictation Extension" to a developer-grade dictation *tool* with two surfaces — the shipped VS Code extension and a Public-Beta native macOS app — on a shared `@verba/core`.

**Architecture:** Pure documentation change, executed in nine waves so the mkdocs site stays buildable after every wave. Shared dictation intelligence is documented once under a new "Core Features" strand; two surface strands (VS Code, macOS Beta) carry setup/usage + surface-specific config. `mkdocs build --strict` is the hard verification gate (there are no unit tests for prose).

**Tech Stack:** Markdown, MkDocs + Material theme (`mkdocs.yml`), `pymdownx.snippets`. No code/product changes.

**Spec:** `docs/superpowers/specs/2026-07-05-verba-repositioning-docs-design.md` (read it before starting).

## Global Constraints

Every task implicitly includes these. Values are verbatim and canonical.

- **Verification gate (docs waves):** `mkdocs build --strict` must exit 0. Run from repo root. Ensure `mkdocs --version` works first (the repo uses Material for MkDocs).
- **Commits:** One commit per wave (= per task), created **only** via `/git-workflow:commit` (German, Emoji Conventional Commit, **no** `Co-Authored-By` / "Generated with" suffixes). Never `git commit` manually. Never `git add -A` / `git add .` — stage explicit paths. Do **not** push.
- **No CHANGELOG entry** (docs are not shipped extension changes).
- **No named competitors** anywhere (no "Wispr Flow", "Superwhisper", etc.).
- **macOS app = Public Beta:** always marked Beta; install path is **build from source** only (no `.dmg`, no "Download"). Its hotkey is `Ctrl+Alt+D`.
- **Config paths (keep correct per surface):** VS Code → `settings.json` + `.verba-glossary.json` / `.verba-expansions.json`; macOS → `~/.config/verba/config.json` (XDG, top-level bare keys, **no** `verba.` prefix).
- **Canonical copy — Umbrella positioning** (reuse verbatim in README hero, `docs/index.md`, and adapt for metadata):
  > **Verba — developer-grade voice dictation, everywhere you type.**
  > Speak instead of type. Verba records your voice, transcribes it with **Deepgram Nova-3**, and refines it with **Claude** — **system-wide across macOS (Beta)** or **deep inside VS Code**. Bring your own keys, keep your data.
- **Canonical copy — Per-surface one-liners:**
  - VS Code: *"Dictate into your editor and terminal, with code-aware AI templates."*
  - macOS (Beta): *"System-wide dictation into any app — press a hotkey, speak, and Verba pastes clean text wherever your cursor is."*
- **Canonical copy — Why Verba (4 differentiators, no competitor names):**
  1. **Bring Your Own Key** — your own Deepgram + Anthropic keys; no subscription.
  2. **Privacy & data control** — keys in the OS keystore; optional fully offline transcription (whisper.cpp); your audio/text is never routed through us.
  3. **Developer- & code-aware** — code-aware templates, Claude Code prompt generation, commit messages, JavaDoc, deep VS Code integration.
  4. **Everywhere** — the same dictation intelligence in your editor *and* across your whole Mac.
- **Fact sources (cite the code, don't invent):** hotkey `apps/macos/src/main.ts:6`; macOS config schema `packages/core/src/config.ts` (`resolveConfig`); default templates `packages/core/src/config/defaultTemplates.json`; macOS Rust commands `apps/macos/src-tauri/src/*.rs`; VS Code commands & features `CLAUDE.md` (Conventions + Implementation Phases). Verify any claim against these before writing it.
- **Docs are written in English** (project convention). Commit messages are in German (commit-skill convention).

---

## File Structure

**Metadata / repo-root:**
- `README.md` — product-level rewrite (Wave 1)
- `CLAUDE.md` — monorepo-reality rewrite (Wave 2)
- `apps/macos/README.md` — fix stale status (Wave 0)
- `package.json` (root) — `description` string only (Wave 0)
- `mkdocs.yml` — `site_description` (Wave 0) + `nav` + `exclude_docs` (Wave 3)

**docs/ moves (git mv, Wave 3):**
- `getting-started/installation.md` → `vscode/installation.md`
- `getting-started/quickstart.md` → `vscode/quickstart.md`
- `guide/templates.md` → `concepts/templates.md`
- `guide/terminal.md` → `vscode/editor-terminal.md`
- `guide/claude-code.md` → `vscode/claude-code.md`
- `guide/configuration.md` → `vscode/configuration.md`
- `development/phase-1-macos-app.md` → `development/macos-internals.md`

**docs/ new pages:**
- `getting-started/choose-surface.md`, `getting-started/prerequisites.md` (Wave 3)
- `macos/overview.md`, `macos/installation.md`, `macos/usage.md`, `macos/configuration.md`, `macos/permissions.md` (Wave 4)
- `concepts/how-it-works.md`, `concepts/glossary.md`, `concepts/expansions.md`, `concepts/voice-commands.md`, `concepts/byok.md` (Wave 5)
- `vscode/offline.md`, `vscode/history.md` (Wave 6)

**docs/ rewrites:** `index.md` (Wave 3), `development/architecture.md`, `development/contributing.md` (Wave 7).

---

## Task 0 (Wave 0): Positioning primitives & metadata

**Files:**
- Modify: `mkdocs.yml` (`site_description`)
- Modify: `package.json` (root, `description`)
- Modify: `apps/macos/README.md` (Status section)

**Interfaces:**
- Produces: the canonical umbrella framing in metadata, reused by all later waves. No later task depends on code from here.

- [ ] **Step 1: Verify mkdocs builds at baseline**

Run: `mkdocs build --strict`
Expected: exit 0 (if it fails on `docs/superpowers/` "not in nav", note it — Wave 3 adds the exclude; for Wave 0 you may `mkdocs build` without `--strict` to confirm the toolchain works).

- [ ] **Step 2: Update `mkdocs.yml` `site_description`**

Replace:
```yaml
site_description: The Developer's Dictation Extension — Voice dictation with AI-powered post-processing for VS Code
```
with:
```yaml
site_description: Developer-grade voice dictation, everywhere you type — AI-powered dictation system-wide on macOS (Beta) or deep inside VS Code.
```

- [ ] **Step 3: Update root `package.json` `description`**

Current: `"The Developer's Dictation Extension – Voice dictation with AI-powered post-processing for VS Code"`.
Set to (Marketplace-friendly, umbrella framing, still names VS Code because this is the extension manifest):
```json
"description": "Developer-grade voice dictation with AI post-processing — dictate into your editor and terminal, powered by Deepgram Nova-3 and Claude. Bring your own keys.",
```
Do **not** touch `apps/macos/package.json` or `packages/core/package.json` descriptions.

- [ ] **Step 4: Fix stale `apps/macos/README.md` status**

The current "## Status: M3 in progress — onboarding UI done, paste still open" is wrong: paste, config, templates, settings UI, and visualization all ship. Rewrite the Status heading and bullets to reflect the current feature set (verify each against `apps/macos/src-tauri/src/*.rs` + `apps/macos/src/*`):
- Menu-bar (tray) accessory app; global hotkey `Ctrl+Alt+D` toggles capture.
- Native mic capture (cpal → WAV) + native Deepgram transcription (`transcribe.rs`).
- `CleanupService` post-processing + **paste into the frontmost app** (`paste_text`), with clipboard restore.
- Config system at `~/.config/verba/config.json` (language, glossary, expansions, templates, activeTemplate); tray menu for provider/template/config.
- HUD working-state visualization; Accessibility + Microphone permission onboarding.
- Mark the surface **Public Beta**; distribution (`.dmg`) not yet available — run via `just macos-dev`.
Keep the existing "Layout" and deeper sections; only the Status section changes.

- [ ] **Step 5: Verify build still green**

Run: `mkdocs build --strict` (or `mkdocs build` if Wave 3 exclude not yet added)
Expected: exit 0.

- [ ] **Step 6: Commit (Wave 0)**

Stage exactly: `mkdocs.yml package.json apps/macos/README.md`. Then run `/git-workflow:commit` with intent: *"📚 docs: Positionierung auf Produkt-Ebene heben (Metadaten + macOS-README-Status)"*. Do not push.

---

## Task 1 (Wave 1): README.md — product-level rewrite

**Files:**
- Modify: `README.md` (full restructure)

**Interfaces:**
- Consumes: canonical copy from Global Constraints.
- Produces: the public entry point; docs links point at the new nav paths introduced in Waves 3–6 (use the target paths now — the site is separate from README rendering on GitHub, and the mkdocs URLs resolve once those waves land).

- [ ] **Step 1: Rewrite the header block**

Keep the centered `<h1>Verba</h1>`. Replace the tagline/hero with the umbrella tagline (Global Constraints). Badges: keep Marketplace version + installs + MIT + Platform; add a discreet Beta badge:
```html
<img src="https://img.shields.io/badge/macOS%20app-Beta-orange" alt="macOS app: Beta">
```
No "Download .dmg" anywhere.

- [ ] **Step 2: Write the "Why Verba" section**

Add a `## Why Verba` section using the 4 canonical differentiators (Global Constraints) as bolded bullets. No competitor names.

- [ ] **Step 3: Write "Two ways to use Verba"**

Add `## Two ways to use Verba` with two subsections:
- `### VS Code Extension` — the shipped flagship. Per-surface one-liner + Marketplace install line (`ext install talent-factory.verba` / marketplace link) + "Full guide → docs `vscode/installation.md`".
- `### macOS App (Beta)` — per-surface one-liner + "**Beta — build from source**" + pointer to docs `macos/installation.md`. State clearly: no packaged download yet.

- [ ] **Step 4: Regroup the Features list**

Replace the flat list with three labelled groups (largest structural change). Verify each item against `CLAUDE.md`:
- **Core dictation intelligence (both surfaces):** streaming post-processing, course correction, voice commands, glossary/dictionary, text expansions, prompt templates.
- **VS Code:** editor & terminal insertion, multi-cursor/selection-aware, dictation history & full-text search, continuous dictation, offline transcription (whisper.cpp), file-type-aware templates.
- **macOS (Beta):** system-wide global hotkey, paste into the frontmost app, menu-bar configuration + template picker, HUD working visualization, Keychain-backed keys.

- [ ] **Step 5: Update Prerequisites / Get started / Configuration / Architecture**

- Prerequisites: ffmpeg, Deepgram key, Anthropic key (shared). Keep the existing ffmpeg install snippets.
- Get started: brief pointer per surface into docs (VS Code quickstart; macOS build-from-source).
- Configuration: one paragraph distinguishing `settings.json`/`.verba-*.json` (VS Code) from `~/.config/verba/config.json` (macOS), each linking to its docs Configuration page.
- Architecture: short monorepo diagram (ASCII or mermaid) — `@verba/core` shared by the VS Code extension and the Tauri macOS app — linking `docs/development/architecture.md`.

- [ ] **Step 6: Insert macOS screenshot placeholder**

Keep the existing `images/screenshots/dictation-workflow.gif` (VS Code). In the macOS subsection add an HTML comment placeholder:
```html
<!-- TODO: add macOS menu-bar / HUD screenshot (images/screenshots/macos-hud.png) -->
```

- [ ] **Step 7: Verify links & spelling of paths**

Manually check every relative link target matches a nav path from the spec (§6). No broken anchors to removed pages.

- [ ] **Step 8: Commit (Wave 1)**

Stage exactly: `README.md`. Run `/git-workflow:commit` with intent *"📚 docs: README auf zwei Oberflächen + Why-Verba umstellen"*. Do not push.

---

## Task 2 (Wave 2): CLAUDE.md — monorepo reality

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: updated agent guidance; no downstream code dependency.

- [ ] **Step 1: Rewrite the "## Project" section**

State Verba is a voice-dictation product with **two surfaces on a shared `@verba/core`**: the VS Code extension (shipped) and the native macOS app (Tauri, **Beta**). Keep repository + Linear links. Adopt the umbrella tagline.

- [ ] **Step 2: Update "## Tech Stack"**

Add: Tauri/Rust (macOS host); monorepo via npm workspaces — `packages/core` (`@verba/core`), `apps/macos` (Tauri app), repo root (VS Code extension).

- [ ] **Step 3: Update "## USPs"**

Reframe USP 1 from "Native VS Code Integration" to native integration **in the editor and across the OS**. Keep developer-specific templates + BYOK.

- [ ] **Step 4: Add a "macOS App (Tauri, Beta)" block under Implementation Phases**

Keep the existing VS Code phase list unchanged. Add a new subsection listing (verify against `apps/macos/`): tray accessory app; global hotkey `Ctrl+Alt+D`; native cpal capture; native Deepgram (WebView constraint — `@deepgram/sdk` cannot run in WebView); Accessibility paste (`paste_text`) + clipboard restore; config system (`~/.config/verba`); template picker; settings UI; HUD visualization; Keychain via `keyring`.

- [ ] **Step 5: Add "## Monorepo Layout"**

New section: map of `packages/core` / `apps/macos` / root. Include verbatim the rule: *"Hosts import `@verba/core` from `dist/` (package `main` → `dist/index.js`), not `src/`. After changing `packages/core/src/**`, run `npm run compile:core` — `just macos-*` does this automatically; a direct `npm run tauri dev` does not."*

- [ ] **Step 6: Extend "## Conventions" with the two gotchas**

Add:
1. Stale-dist gotcha (from Step 5) — a stale dist manifests as a dead macOS hotkey with no notification.
2. macOS config schema: top-level bare keys (`language`, `transcription.language`, `glossary`, `expansions`, `templates`, `activeTemplate`, `audioDevice`), **no** `verba.` prefix; a VS Code–style `verba.language` key is silently ignored. Templates are all-or-nothing (one invalid entry → the 9 bundled defaults). Config lives at `~/.config/verba/config.json` (XDG).

- [ ] **Step 7: Split "## Architecture"**

Restructure into: (a) monorepo/build overview (1 short paragraph + the core→hosts diagram), (b) the existing module table retitled **"VS Code host"** (unchanged rows), (c) a new **"macOS host"** table for `apps/macos/src/*` (`main.ts`, `wiring.ts`, `controller.ts`, `deepgramTauriProvider.ts`, `config/verbaConfig.ts`, `visualization/*`, `ui.ts`) and `apps/macos/src-tauri/src/*` (`config.rs`, `menu.rs`, `store.rs`, `transcribe.rs`, capture/paste commands). One-line purpose each — verify each file exists.

- [ ] **Step 8: Note release scope**

In the Release Workflow section, add one line: release-please versions the **VS Code extension only**; the Beta macOS app has no release path yet — keep it out of the release-please flow.

- [ ] **Step 9: Commit (Wave 2)**

Stage exactly: `CLAUDE.md`. Run `/git-workflow:commit` with intent *"📚 docs: CLAUDE.md auf Monorepo-Realität (core + zwei Hosts) aktualisieren"*. Do not push.

---

## Task 3 (Wave 3): docs scaffold — Home, nav, moves

**Files:**
- Modify: `mkdocs.yml` (`nav`, `exclude_docs`)
- Modify: `docs/index.md` (rewrite)
- Move (git mv): the 7 pages in the File Structure section
- Create: `docs/getting-started/choose-surface.md`, `docs/getting-started/prerequisites.md`
- Create empty dirs implicitly via git mv: `docs/vscode/`, `docs/concepts/`, `docs/macos/`

**Interfaces:**
- Produces: the new nav skeleton every later wave fills. New pages created here are stubs *only* for pages authored in later waves — but this wave must leave the build **green**, so every nav entry must point at an existing file. Author placeholders as single-sentence stubs that later waves replace.

- [ ] **Step 1: git mv existing pages**

Run each (creates target dirs):
```bash
mkdir -p docs/vscode docs/concepts docs/macos
git mv docs/getting-started/installation.md docs/vscode/installation.md
git mv docs/getting-started/quickstart.md docs/vscode/quickstart.md
git mv docs/guide/templates.md docs/concepts/templates.md
git mv docs/guide/terminal.md docs/vscode/editor-terminal.md
git mv docs/guide/claude-code.md docs/vscode/claude-code.md
git mv docs/guide/configuration.md docs/vscode/configuration.md
git mv docs/development/phase-1-macos-app.md docs/development/macos-internals.md
```

- [ ] **Step 2: Fix internal links broken by the moves**

Grep for references to the old paths and update them:
```bash
grep -rn "getting-started/installation\|getting-started/quickstart\|guide/templates\|guide/terminal\|guide/claude-code\|guide/configuration\|phase-1-macos-app" docs/ mkdocs.yml apps/macos/README.md README.md
```
Update each hit to the new path. Also check `pymdownx.snippets` includes and any `--8<--` references.

- [ ] **Step 3: Replace `mkdocs.yml` `nav`**

Set `nav` to exactly:
```yaml
nav:
  - Home: index.md
  - Getting Started:
    - Choose Your Surface: getting-started/choose-surface.md
    - Prerequisites: getting-started/prerequisites.md
  - Core Features:
    - How Verba Works: concepts/how-it-works.md
    - Prompt Templates: concepts/templates.md
    - Glossary & Dictionary: concepts/glossary.md
    - Text Expansions: concepts/expansions.md
    - Voice Commands & Course Correction: concepts/voice-commands.md
    - Bring Your Own Key & Privacy: concepts/byok.md
  - VS Code Extension:
    - Installation: vscode/installation.md
    - Quick Start: vscode/quickstart.md
    - Editor & Terminal: vscode/editor-terminal.md
    - Claude Code Integration: vscode/claude-code.md
    - Offline Transcription: vscode/offline.md
    - Dictation History: vscode/history.md
    - Configuration: vscode/configuration.md
  - macOS App (Beta):
    - Overview & Status: macos/overview.md
    - Installation: macos/installation.md
    - Usage: macos/usage.md
    - Configuration: macos/configuration.md
    - Permissions: macos/permissions.md
  - Development:
    - Architecture: development/architecture.md
    - Cross-Platform Strategy: development/cross-platform-strategy.md
    - macOS App Internals: development/macos-internals.md
    - ADR - Deepgram Migration: development/adr-deepgram-migration.md
    - Contributing: development/contributing.md
  - Changelog: changelog.md
```

- [ ] **Step 4: Ensure `exclude_docs` covers superpowers/**

Update `exclude_docs` so strict build ignores non-nav internal docs:
```yaml
exclude_docs: |
  plans/
  ROADMAP.md
  superpowers/
```

- [ ] **Step 5: Create stub pages for not-yet-authored nav entries**

Every nav target must exist now. For each of these, create a one-line stub `# <Title>\n\n> Documentation in progress.` (later waves replace them):
`concepts/how-it-works.md`, `concepts/glossary.md`, `concepts/expansions.md`, `concepts/voice-commands.md`, `concepts/byok.md`, `vscode/offline.md`, `vscode/history.md`, `macos/overview.md`, `macos/installation.md`, `macos/usage.md`, `macos/configuration.md`, `macos/permissions.md`.

- [ ] **Step 6: Author `getting-started/choose-surface.md`**

Real content (short): a 2-column comparison — "Use the **VS Code extension** if you live in the editor / want code-aware templates, terminal insert, offline mode" vs "Use the **macOS app (Beta)** if you want dictation in *any* app system-wide". Link each to its Installation page. State the macOS app is Beta / build-from-source.

- [ ] **Step 7: Author `getting-started/prerequisites.md`**

Extract the shared prerequisites from the old installation page: ffmpeg (with the existing per-OS install snippets), a Deepgram API key (Nova-3), an Anthropic API key (Claude); note the offline alternative (whisper.cpp) links to `vscode/offline.md`. Keep VS Code–specific install steps in `vscode/installation.md` (trim them out of prerequisites).

- [ ] **Step 8: Rewrite `docs/index.md`**

Product overview: umbrella tagline hero, the Why-Verba differentiators (short), "Two surfaces" cards linking `vscode/installation.md` and `macos/overview.md`, and a "New here? → Choose Your Surface" pointer. Keep the existing logo/front-matter conventions used by Material.

- [ ] **Step 9: Verify strict build green with the full new nav**

Run: `mkdocs build --strict`
Expected: exit 0, no "not in nav" or missing-file warnings.

- [ ] **Step 10: Commit (Wave 3)**

Stage exactly the moved files, `mkdocs.yml`, `docs/index.md`, and the new/stub pages under `docs/getting-started/ docs/concepts/ docs/vscode/ docs/macos/`. Run `/git-workflow:commit` with intent *"📚 docs: mkdocs-Nav auf zwei Oberflächen umbauen (Home, Moves, Gerüst)"*. Do not push.

---

## Task 4 (Wave 4): macOS App (Beta) strand

**Files:**
- Modify (replace stubs): `docs/macos/overview.md`, `installation.md`, `usage.md`, `configuration.md`, `permissions.md`

**Interfaces:**
- Consumes: fact sources in Global Constraints (`apps/macos/**`, `packages/core/src/config.ts`).

- [ ] **Step 1: `macos/overview.md`**

Beta banner (Material admonition `!!! warning "Public Beta"`). What the app is (per-surface one-liner), the end-to-end flow (hotkey → capture → Deepgram → Claude cleanup → paste), current status (functional; no packaged build; run via `just macos-dev`), and the screenshot TODO placeholder. Link to Installation/Usage.

- [ ] **Step 2: `macos/installation.md`**

Build-from-source only. Prereqs: Rust toolchain + Tauri CLI deps, Node, ffmpeg (link prerequisites), the repo. Steps:
```bash
git clone https://github.com/talent-factory/verba.git
cd verba
npm install
just macos-dev   # compiles @verba/core, starts vite, launches the Tauri app
```
Note `just macos-dev` builds core first (cite the justfile `compile-core` dependency). No `.dmg` yet.

- [ ] **Step 3: `macos/usage.md`**

Menu-bar accessory app (no Dock icon). Hotkey `Ctrl+Alt+D` toggles recording (cite `apps/macos/src/main.ts:6`). Speak → second press stops → transcribe → cleanup → paste into the frontmost app. Tray menu items: provider, template picker ("Vorlage"), "Konfiguration öffnen…", "Konfiguration neu laden". HUD shows recording/working state.

- [ ] **Step 4: `macos/configuration.md`**

The config file `~/.config/verba/config.json` (XDG). Document the schema from `packages/core/src/config.ts` with a full example: `language`, `glossary` (string[]), `expansions` ({abbreviation, expansion}[]), `templates` (see below), `activeTemplate`. **Emphasize** top-level bare keys (no `verba.` prefix). Templates subsection: schema `{name, prompt, icon?, contextAware?, fileTypes?}`, the **all-or-nothing** rule (your array replaces the 9 defaults; include defaults you want to keep), and that `contextAware`/`fileTypes` are VS Code–only (inert on macOS). Reuse a trimmed version of the working example from this session.

- [ ] **Step 5: `macos/permissions.md`**

Microphone (TCC / `NSMicrophoneUsageDescription`) and Accessibility (required for synthetic paste). How the in-app onboarding surfaces an ungranted Accessibility permission with a System-Settings deep link. What breaks without each (no capture / no paste). Cite `apps/macos/src-tauri/src/*` command names (`has_accessibility_permission`, `open_accessibility_settings`).

- [ ] **Step 6: Verify build**

Run: `mkdocs build --strict` → exit 0.

- [ ] **Step 7: Commit (Wave 4)**

Stage exactly `docs/macos/`. Run `/git-workflow:commit` with intent *"📚 docs: macOS-App-Strang (Beta) — Overview, Install, Usage, Config, Permissions"*. Do not push.

---

## Task 5 (Wave 5): Core Features (shared concepts) strand

**Files:**
- Modify (replace stubs / extend move): `docs/concepts/how-it-works.md`, `glossary.md`, `expansions.md`, `voice-commands.md`, `byok.md`; extend `docs/concepts/templates.md` (moved in Wave 3)

**Interfaces:**
- Consumes: `packages/core/src/*` (cleanupService, pipeline, config), `CLAUDE.md`.

- [ ] **Step 1: `concepts/how-it-works.md`**

The shared pipeline: record (ffmpeg/cpal) → transcribe (Deepgram Nova-3, or local whisper.cpp) → post-process (Claude via `CleanupService`) → insert/paste. Explain that this logic lives in `@verba/core` and both surfaces share it; only capture and the text sink differ. Simple diagram.

- [ ] **Step 2: Extend `concepts/templates.md`**

The page was moved from `guide/templates.md` (VS Code–flavored). Reframe as a shared concept: what a template is (a Claude post-processing instruction), the schema `{name, prompt, icon?, contextAware?, fileTypes?}`, the 9 built-in defaults (from `defaultTemplates.json`), and **two configuration locations** — link `vscode/configuration.md` (settings.json `verba.templates`) and `macos/configuration.md` (`~/.config/verba` templates array, all-or-nothing). Keep prompt-writing tips ("Keep the original language", "Return only …").

- [ ] **Step 3: `concepts/glossary.md`**

Protected terms during transcription (Deepgram `keywords`) and cleanup (Claude instruction). Global via setting / `verba.glossary`; project-specific `.verba-glossary.json` (VS Code) and the `glossary` array in `~/.config/verba/config.json` (macOS). Adaptive dictionary generator (VS Code `dictation.generateGlossary`).

- [ ] **Step 4: `concepts/expansions.md`**

User-defined abbreviations expanded during Claude post-processing. `{abbreviation, expansion}` shape. Global `verba.expansions` + `.verba-expansions.json` (VS Code); `expansions` array in `~/.config/verba/config.json` (macOS). Workspace overrides global for the same abbreviation.
> If this page and `glossary.md` are each under ~½ screen, merge both into a single `concepts/glossary.md` "Glossary & Expansions" page, update the nav entry (remove the Text Expansions line), and delete `expansions.md`. Decide by content volume.

- [ ] **Step 5: `concepts/voice-commands.md`**

Voice-driven formatting ("new paragraph", "period", "bullet point") via prompt engineering — language-independent, always active. Course correction: self-corrections detected and removed ("no wait, actually X" → only X). Both shared via `@verba/core` cleanup.

- [ ] **Step 6: `concepts/byok.md`**

Bring-Your-Own-Key + privacy (the canonical Why-Verba differentiators, expanded). Which keys (Deepgram, Anthropic; OpenAI only for embeddings). Storage: VS Code `SecretStorage`; macOS Keychain via `keyring`; env-var override on macOS. Offline option (whisper.cpp) → link `vscode/offline.md`.

- [ ] **Step 7: Verify build**

Run: `mkdocs build --strict` → exit 0. If the expansions/glossary merge happened, confirm the nav has no dangling entry.

- [ ] **Step 8: Commit (Wave 5)**

Stage exactly `docs/concepts/` and (if nav changed) `mkdocs.yml`. Run `/git-workflow:commit` with intent *"📚 docs: Core-Features-Strang — geteilte Diktier-Konzepte"*. Do not push.

---

## Task 6 (Wave 6): VS Code refocus + new pages

**Files:**
- Modify (replace stubs): `docs/vscode/offline.md`, `docs/vscode/history.md`
- Modify (reframe moved pages): `docs/vscode/installation.md`, `quickstart.md`, `editor-terminal.md`, `configuration.md`

**Interfaces:**
- Consumes: `CLAUDE.md` (VS Code features + commands), existing moved page content.

- [ ] **Step 1: `vscode/offline.md`**

Offline transcription via whisper.cpp CLI (macOS). `verba.transcription.provider = local`, `verba.transcription.localModel`; `dictation.downloadModel` (Hugging Face). Strategy pattern on `TranscriptionService`. When to use it (privacy / zero cost).

- [ ] **Step 2: `vscode/history.md`**

Dictation history + full-text search via globalState. Commands `dictation.showHistory`, `dictation.searchHistory`, `dictation.clearHistory`; three actions (insert / copy / details); `verba.history.maxEntries`. Privacy: local only, never sent to APIs.

- [ ] **Step 3: Reframe moved VS Code pages**

- `installation.md`: trim shared prerequisites (now in `getting-started/prerequisites.md`, link it); keep the VS Code extension install (Marketplace, `ext install`), API-key setup via `dictation.manageApiKeys`.
- `quickstart.md`: verify shortcuts (`Cmd+Shift+D`, `Cmd+Alt+T`); add a one-line pointer to the macOS surface.
- `editor-terminal.md`: keep terminal content; ensure links resolve.
- `configuration.md`: settings.json + `.verba-*.json`; link the shared concepts pages (templates/glossary/expansions) instead of duplicating their bodies.

- [ ] **Step 4: Verify build**

Run: `mkdocs build --strict` → exit 0.

- [ ] **Step 5: Commit (Wave 6)**

Stage exactly `docs/vscode/`. Run `/git-workflow:commit` with intent *"📚 docs: VS-Code-Strang refokussieren + Offline/History-Seiten"*. Do not push.

---

## Task 7 (Wave 7): Development strand + final verification

**Files:**
- Modify: `docs/development/architecture.md` (rewrite), `docs/development/contributing.md` (light update)

**Interfaces:**
- Consumes: `CLAUDE.md` Architecture (updated Wave 2), monorepo layout.

- [ ] **Step 1: Rewrite `development/architecture.md`**

Monorepo overview: `@verba/core` (shared dictation logic + adapter seams) consumed by two hosts — VS Code extension and Tauri macOS app. Include the core→hosts diagram, the "hosts import dist not src" note, and per-host module tables (mirror CLAUDE.md's split, but prose-oriented). Cross-link `development/macos-internals.md`.

- [ ] **Step 2: Update `development/contributing.md`**

Monorepo setup: `npm install` (workspaces), `just compile` (core + extension), `just macos-dev` (macOS, builds core first), `mkdocs build --strict` for docs. Note commit convention (Emoji Conventional, `/git-workflow:commit`) and branch flow (`feature/* → develop`).

- [ ] **Step 3: Repo-wide link audit**

Run:
```bash
grep -rn "guide/\|getting-started/installation\|getting-started/quickstart\|phase-1-macos-app" docs/ README.md CLAUDE.md apps/macos/README.md mkdocs.yml
```
Expected: no stale references (all should now point at the new paths). Fix any remaining.

- [ ] **Step 4: Final strict build + toolchain sanity**

Run:
```bash
mkdocs build --strict
just compile      # docs-only change must not affect the TS build
```
Expected: both exit 0.

- [ ] **Step 5: Commit (Wave 7)**

Stage exactly `docs/development/` (and any link fixes from Step 3 in already-committed files — stage those explicit paths). Run `/git-workflow:commit` with intent *"📚 docs: Development-Strang auf Monorepo aktualisieren + Link-Audit"*. Do not push.

---

## Self-Review (completed by plan author)

**Spec coverage:** D1 Beta framing → Waves 0,1,4 (banners, build-from-source). D2 positioning → Global Constraints copy, Waves 0–3. D3 full docs restructure → Waves 3–7 (nav + strands). D4 Why-Verba no competitors → Global Constraints + Waves 1,5. D5 approach A → single plan, coordinated waves. D6 one commit/wave via commit-skill → each task's final step. D7 no CHANGELOG → Global Constraints. README §4 structure → Wave 1 steps 1–6. CLAUDE §5 → Wave 2 steps 1–8. docs IA §6 nav tree → Wave 3 step 3 (verbatim). Stale apps/macos/README + metadata → Wave 0. Two gotchas → Wave 2 steps 5–6. macOS screenshot placeholder → Waves 1,4. glossary/expansions merge option → Wave 5 step 4. `--strict` superpowers/ exclude → Wave 3 step 4. All spec sections map to a task.

**Placeholder scan:** New doc pages are specified by purpose + required facts + fact-source citations, not ghost-written prose (appropriate for a docs plan); the fixed/canonical strings (tagline, Why-Verba, nav YAML, metadata) are given verbatim. The only intentional in-repo placeholder is the macOS screenshot TODO (an explicit deferred asset, not a plan gap).

**Type consistency:** Path names are consistent across waves (e.g., `development/macos-internals.md` used in nav Wave 3, authored Wave 7; `getting-started/prerequisites.md` created Wave 3, linked from Waves 4,6; `concepts/*` stubs Wave 3 → authored Wave 5). Nav entries in Wave 3 match the files each later wave fills. Commit-per-wave holds (7 waves → 7 commits).
