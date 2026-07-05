# Shared Config Schema in `@verba/core`

**Date:** 2026-07-04
**Status:** Approved (design)
**Scope:** `@verba/core` (new schema owner) + both hosts (`apps/macos`, VS Code extension in `src/`).

## Problem

Verba's dictation configuration is defined **twice, incompatibly**:

- **VS Code** reads `verba.*` settings ad-hoc via `vscode.workspace.getConfiguration('verba').get(...)`
  in ~13 scattered call sites across `src/extension.ts`. There is no central config type; each read
  carries its own key string and default. Templates are read with `get<Template[]>('templates', [])`
  and used **largely unvalidated**.
- **macOS** has a centralized but separate schema in `apps/macos/src/config/verbaConfig.ts`
  (`VerbaConfig` raw → `ResolvedConfig`), a nested/unprefixed JSON file, and an independent Rust
  reader for the tray.
- **`@verba/core`** — the deliberate platform-agnostic boundary — owns **no** config logic today.

The two hosts diverge in envelope (VS Code flat `verba.`-prefixed keys vs. macOS nested unprefixed
JSON) and in one real semantic gap: macOS has `transcription.language` (the fix for German
mis-transcribed as Dutch); VS Code lacks it. The values that users actually maintain
(`glossary`, `expansions`, `templates`) are already structurally identical but not portable in
practice because the resolution/validation lives in two places that can drift.

## Goal

Make `@verba/core` the **single source** of the shared dictation-config schema, its defaults, and
its validation. Each host keeps its **native envelope** (VS Code its `verba.*` `settings.json`
keys; macOS its nested `~/.config/verba/config.json`) but feeds raw values through one core
resolver. Result: **semantic** cross-compatibility — `glossary`/`expansions`/`templates` become
copy-paste-portable, and both hosts apply identical validation.

**Chosen compatibility target:** semantic (values portable), not literal (whole `verba.*` blocks
paste 1:1) and not a physically shared file.

## Non-Goals

- No change to either host's on-disk config **format** (no key renames, no `verba.` prefix in the
  macOS file, no shared physical file). Existing user configs keep working unchanged.
- Host-only settings stay host-local and out of the core schema: VS Code's `terminal.executeCommand`,
  `history.maxEntries`, `contextSearch.provider`/`maxResults`, `autoSelectTemplate`.
- No change to VS Code's template-selection UX (Quick-Pick + `autoSelectTemplate` by file type).
  `activeTemplate` remains a macOS-only persistence concern (kept in the schema; VS Code ignores it).

## Approach

**Core owns a schema + a pure resolver; each host supplies raw values via a `ConfigProvider`
adapter (Approach A).** Core stays stateless; reactivity remains host-side (macOS `config:changed`
→ reload; VS Code reads on demand). The resolver consumes the **existing per-key `ConfigProvider`
interface** already declared in `packages/core/src/adapters.ts`
(`get<T>(key: string, defaultValue: T): T`), which maps 1:1 to VS Code's `getConfiguration().get()`.

### Data flow (identical for both hosts)

```
Host raw source ──► ConfigProvider (adapter) ──► resolveConfig() ──► ResolvedConfig ──► provider/cleanup
  macOS: JSON file (Rust read_config)             [@verba/core: pure, tested]
  VS Code: getConfiguration('verba')
```

- **macOS adapter** (`ObjectConfigProvider`): reads the file once (`read_config` IPC), parses to an
  object, and resolves dotted keys (`transcription.language`) by walking the in-memory object. No
  repeated IPC.
- **VS Code adapter** (`VsCodeConfigProvider`): `get(key, d) => getConfiguration('verba').get(key, d)`.

## Core Contract — `packages/core/src/config.ts` (new module)

**Note — `Template` is the union of both hosts' fields.** macOS uses `icon` (tray prefix); VS Code
uses `fileTypes` (file-type auto-select via `findTemplateForLanguage`). Core's `Template` is the
superset so neither regresses; each host ignores the field it doesn't use. VS Code's local
`Template` in `src/templatePicker.ts` (which lacks `icon`) is replaced by the core type.

```ts
export interface Template { name: string; prompt: string; icon?: string; contextAware?: boolean; fileTypes?: string[]; }

/** Raw — exactly the fields a host can supply; all optional/untrusted. */
export interface VerbaConfig {
  language?: string;                    // cleanup language
  transcription?: { language?: string; provider?: string; localModel?: string };
  glossary?: string[];
  expansions?: Expansion[];
  templates?: unknown[];                // untrusted until validated
  activeTemplate?: string;
  audioDevice?: string;
}

/** Resolved — every field concrete; total downstream. */
export interface ResolvedConfig {
  language: string; transcriptionLanguage: string;
  provider: string; localModel: string;
  glossary: string[]; expansions: Expansion[];
  templates: Template[]; activeTemplate: Template;
  audioDevice?: string;
}

export const DEFAULT_TEMPLATES: Template[];   // the 9 canonical templates (from defaultTemplates.json)

export function resolveConfig(provider: ConfigProvider): ResolvedConfig;
```

`Template` and `VerbaConfig` are **removed** from macOS `verbaConfig.ts` and re-exported from core.
Core exports the above via `index.ts`.

### Defaults (canonical, both hosts)

`language='auto'`, `transcriptionLanguage='multi'`, `provider='deepgram'`, `localModel='base'`,
`glossary=[]`, `expansions=[]`, `templates=DEFAULT_TEMPLATES`, `activeTemplate=DEFAULT_TEMPLATES[0]`,
`audioDevice=undefined`.

### `resolveConfig` rules (never throws; per-field fallback)

- Reads each key via `provider.get(key, default)`.
- Strings pass a `nonEmptyString` check (empty/whitespace → default).
- **Templates: all-or-nothing.** Honor `templates` only if it is a non-empty array **and every**
  entry is an object with a non-empty (trimmed) string `name` and a string `prompt`; otherwise
  `DEFAULT_TEMPLATES`. (A half-broken template menu is worse than the defaults.)
- **Glossary / expansions: per-element** (decided during implementation; supersedes macOS's earlier
  all-or-nothing). `glossary` keeps each non-empty (trimmed) string entry and drops the rest;
  `expansions` keeps each entry with string `abbreviation` + `expansion` and drops the rest. A single
  stray entry no longer discards the whole list (restores VS Code's prior forgiving behavior; macOS
  benefits too). A non-array falls back to `[]`.
- `activeTemplate`: the entry named `activeTemplate` from the resolved template list, else the first.

This is macOS's current `loadConfig` logic moved into core, extended with `provider`/`localModel`.

### Unavoidable duplication (accepted)

The Rust tray (`apps/macos/src-tauri/src/menu.rs` → `template_choices_from_value`) cannot call
TS core, so it keeps its own validity check. Parity is guarded by tests on both sides (existing
pattern). This is the single, architecture-inherent TS↔Rust duplication point.

## macOS Host Wiring (`apps/macos`)

- `src/config/verbaConfig.ts`: `VerbaConfig`/`Template` types and the resolve/validation logic
  are removed (re-exported from core). Add a small **`ObjectConfigProvider`** (dotted-key `get`
  over the parsed object). `loadConfig()` becomes thin: `JSON.parse(read_config())` →
  `new ObjectConfigProvider(obj)` → `resolveConfig(provider)`. The `onMalformed` callback (from the
  prior PR) is retained.
- `src/config/defaultTemplates.json` **moves** to `packages/core/src/config/defaultTemplates.json`;
  core exports `DEFAULT_TEMPLATES` from it. Rust `config.rs` points its `include_str!` at the core
  file via a workspace-relative path (chosen over a macOS-local copy + parity test — true single source).
- Rust stays transport: `read_config`, `read_config_value`, `read_template_choices`/
  `template_choices_from_value` unchanged except the templates-JSON path.
- macOS `config.json` format is **unchanged** — no user-file migration.

`applyConfig`/`cleanupContextFor` (the `ResolvedConfig` → provider/cleanup mapping) **stay
host-side** in this spec — the goal is a single *schema* source, which they don't block. Sharing
that mapping is a separate follow-up (YAGNI here).

## VS Code Host Wiring (`src/`)

- New **`VsCodeConfigProvider`**: thin wrapper satisfying `ConfigProvider` directly.
- New host helper **`resolvedVerbaConfig(): ResolvedConfig`** = `resolveConfig(new VsCodeConfigProvider())`,
  called **on demand** (getConfiguration is cheap and always fresh → no cache /
  `onDidChangeConfiguration` reactivity needed).
- Redirect the cleanly-mappable shared-field reads to `resolvedVerbaConfig()`: `language`
  (extension.ts:85, 163 — the setting value), `audioDevice` (598, 644, 1565), and `templates` via
  `loadTemplates()` (289; used 539/803/1379). `loadTemplates()` and the local `Template` interface
  are removed in favor of core types + core validation (VS Code thereby gains the all-or-nothing
  behavior it lacks today).
- **`glossary`/`expansions` — setting-level only.** VS Code's `loadGlossary`/`loadExpansions`
  (extension.ts:192–260, 300+) merge the `verba.*` setting **with workspace files**
  (`.verba-glossary.json`, `.verba-expansions.json`), including validation warnings and case-folding.
  Core cannot own that (no `fs`; macOS has no such merge). So core validates only the **setting-level**
  array (`resolvedVerbaConfig().glossary` / `.expansions`); the host keeps its workspace-file merge on
  top. This bounds core to the schema authority without swallowing VS-Code-specific behavior.
- Add **`verba.transcription.language`** to `package.json` `contributes.configuration` (default
  `"multi"`, enum as macOS) as a **backward-compatible optional override** for the transcription
  language. `verba.language` currently drives **both** transcription (`applyLanguageSetting` →
  `setLanguage`) and cleanup (`resolveLanguage`). New behavior: transcription uses
  `verba.transcription.language` when the user has set it (non-default/present); otherwise it falls
  back to today's `verba.language`-derived behavior. Cleanup language stays sourced from
  `verba.language`. No regression for existing configs; new setting gives explicit control and macOS
  parity ("level up", not down).
- Host-only settings (`history.*`, `terminal.*`, `contextSearch.*`, `autoSelectTemplate`) are untouched.
- VS Code `settings.json` keys are unchanged for users.

**Behavior change (accepted):** a single broken template entry now falls back to the 9 defaults for
the whole array (consistent with macOS), rather than loading partially.

## Migration & Back-Compat

- No breaking changes: macOS file and VS Code `settings.json` keys unchanged; `verba.transcription.language`
  is additive (absent = prior behavior).
- **Canonical templates are the union.** The core `defaultTemplates.json` merges macOS's `icon`
  fields with VS Code's `fileTypes` (JavaDoc → java/kotlin, Markdown → markdown). macOS gains
  nothing visible (already had icons); VS Code keeps its auto-select (fileTypes preserved) and
  additionally carries icons it simply ignores.
- **Default-templates duplication:** core is the logical single source, but VS Code's `package.json`
  `verba.templates` default is a static manifest that cannot import core, so it remains a second
  physical copy. It is **updated to match** the unioned core set exactly (adds `icon` fields, keeps
  `fileTypes`). Guard: a **parity test** asserting `package.json`'s `verba.templates` default
  deep-equals core `DEFAULT_TEMPLATES` (fails CI on drift).

## Testing

- **Core `config.test.ts` (primary):** `resolveConfig` against a `FakeConfigProvider` (in-memory
  map), no host dependency. Absorbs today's macOS `verbaConfig.test.ts` cases plus
  `provider`/`localModel`: all-defaults on empty, per-field wrong-type fallback, templates
  all-or-nothing (whitespace name, empty array, valid+invalid mix, multi-entry verbatim), expansions
  validation, `activeTemplate` (named/missing), dotted keys.
- **macOS:** `ObjectConfigProvider` traversal (flat, nested, missing, non-string); `loadConfig` thin
  integration (`onMalformed` still fires); Rust `template_choices_from_value` parity tests remain;
  `include_str!` path compiles (build gate).
- **VS Code:** `VsCodeConfigProvider` maps `get` correctly (fake `getConfiguration`);
  `resolvedVerbaConfig` returns validated config incl. the new all-or-nothing semantics; **parity
  test** `package.json` `verba.templates` default ≡ core `DEFAULT_TEMPLATES`.
- **Gates:** existing suites green (macOS 63 TS / 44 Rust, VS Code suite, core suite),
  `tsc --noEmit`, `cargo clippy -D warnings`.

## Components (isolation)

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `core/config.ts` | Schema types, defaults, `resolveConfig`, `DEFAULT_TEMPLATES` | `ConfigProvider`, `Expansion` (core) |
| `core/config/defaultTemplates.json` | The 9 canonical templates | — |
| macOS `ObjectConfigProvider` | Dotted-key `get` over parsed JSON | `ConfigProvider` |
| macOS `loadConfig` (thin) | file → provider → `resolveConfig` | core, Rust `read_config` |
| VS Code `VsCodeConfigProvider` | `get` over `getConfiguration('verba')` | `ConfigProvider`, `vscode` |
| VS Code `resolvedVerbaConfig` | provider → `resolveConfig` | core |
