# macOS Post-Processing Templates — Design

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Component:** `apps/macos`

## Problem

The VS Code extension lets the user pick a post-processing *template* (a system
prompt) that shapes how Claude cleans up a transcript — "Commit Message",
"E-Mail", "Markdown", etc. The macOS menu-bar app has none: every dictation runs
through the default cleanup prompt only.

The post-processing *engine* already supports templates. `@verba/core`'s
`CleanupService` reads `PipelineContext.templatePrompt`; when set, it swaps the
default `CLEANUP_SYSTEM_PROMPT` for `TEMPLATE_FRAMING + templatePrompt` (which
still carries course-correction and voice-command instructions). The macOS app
simply never sets `templatePrompt`.

This design wires templates into the macOS app: template definitions live as
**config data** (not hard-coded in source), the user picks the active template
from the **tray menu**, and the chosen prompt flows into the existing cleanup
context.

## Goals

- Template definitions are data (a bundled JSON file + user override in
  `config.json`), never hard-coded in TypeScript or Rust.
- The user selects the active template from a persisted tray submenu, consistent
  with the existing Language/Provider menus.
- Selecting a template applies to the next dictation with no restart (reuses the
  existing `config:changed` live-reload path).
- No changes to `@verba/core` or the VS Code extension.

## Non-Goals

- No popup/Quick-Pick picker window. A focused window mid-flow risks stealing
  focus and breaking the ⌘V paste (known macOS gotcha). Tray-only.
- No per-dictation switching. The active template persists until changed.
- No `autoSelectTemplate` / `fileTypes` auto-selection. A system-wide menu-bar
  app has no "active file", so file-type auto-selection is meaningless here.
- No new icon assets — emoji labels only.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Selection UX | Tray submenu, persisted active template | Consistent with existing tray settings; no window ⇒ no focus-steal / paste breakage |
| Storage | Bundled default JSON + `config.json` override | Prompts stay data; fresh installs work out of the box; power users edit one file |
| Default set | The existing VS Code 9 | Parity with the extension; single mirrored source |

## Default template set (the VS Code 9)

Mirrors `package.json` → `verba.templates` default, with an added emoji `icon`
per template for the tray label:

1. **Freitext** — general cleanup (default active template)
2. **Commit Message**
3. **JavaDoc**
4. **Markdown**
5. **E-Mail**
6. **Code Comment** *(contextAware)*
7. **Explain Code** *(contextAware)*
8. **Claude Code Prompt** *(contextAware)*
9. **Transform Selection**

**Known limitation (parity choice):** items 6–9 were built around live editor
context / selection, which a menu-bar app does not provide. On macOS their
prompt still applies, but they run without code snippets or a `<selection>`
block. No special handling — documented and accepted.

## Architecture

```
Tray "Vorlage" submenu (menu.rs)
        │ click → write_config_key("activeTemplate", name)
        ▼
   config.json  ──emit "config:changed"──▶ main.ts ──▶ reloadConfig()
   { activeTemplate, templates? }                          │
        ▲                                                   ▼
        │ read defaults                            loadConfig() (verbaConfig.ts)
        │                                                   │ resolves activeTemplate
defaultTemplates.json  ◀── include_str! (Rust)              ▼
   (single source)     ◀── import (TS)          wiring.ts cleanup wrapper
                                                injects templatePrompt into context
                                                            │
                                                            ▼
                                              @verba/core CleanupService
                                              TEMPLATE_FRAMING + templatePrompt
```

### Single source of truth

New file **`apps/macos/src/config/defaultTemplates.json`** — an array of
`{ name, prompt, icon?, contextAware? }`. Read by:

- **TypeScript** (`verbaConfig.ts`): `import defaultTemplates from './defaultTemplates.json'`.
- **Rust** (`config.rs`): `include_str!("../../src/config/defaultTemplates.json")`,
  parsed with `serde_json`.

Keeping it next to `verbaConfig.ts` makes the TS import natural; Rust reaches two
directories up (it already `include_bytes!`s icon assets from `../icons`).

## Config schema (`config.json`)

Two new optional keys:

```jsonc
{
  "activeTemplate": "Freitext",   // name of the selected template
  "templates": [                  // optional; if present, REPLACES the defaults
    { "name": "My Template", "prompt": "…", "icon": "🎯" }
  ]
}
```

- `templates` absent/invalid → the bundled defaults are used.
- `templates` present and valid → it fully replaces the defaults (not merged).
- `activeTemplate` absent, or naming a template not in the list → falls back to
  the **first** template in the effective list (Freitext for defaults).

## Components

### 1. `verbaConfig.ts` (frontend resolution)

- New exported `Template` interface: `{ name: string; prompt: string; icon?: string; contextAware?: boolean }`.
- `DEFAULT_TEMPLATES: Template[]` derived from the imported JSON.
- `ResolvedConfig` gains: `templates: Template[]`, `activeTemplate: Template`.
- New validator `isTemplateArray(v): v is Template[]` — array of objects each
  with non-empty string `name` and string `prompt`.
- New pure helper `resolveActiveTemplate(templates, name?): Template` — returns
  the named template or the first (unit-testable, no I/O).
- `loadConfig`:
  - `templates = isTemplateArray(raw.templates) && raw.templates.length > 0 ? raw.templates : DEFAULT_TEMPLATES`
  - `activeTemplate = resolveActiveTemplate(templates, raw.activeTemplate)`
- `ApplyTargets` / `applyConfig`: **unchanged**. Templates are read at
  process-time from `configState.current`, not pushed into a stateful service.

### 2. `wiring.ts` (prompt injection)

The existing `cleanup.process` wrapper injects `detectedLanguage` from
`configState.current`. Extend it to also set `templatePrompt`:

```ts
process: (transcript, context) =>
  cleanup.process(transcript, {
    ...context,
    templatePrompt: configState.current.activeTemplate.prompt,
    ...(configState.current.language !== 'auto'
      ? { detectedLanguage: configState.current.language }
      : {}),
  }),
```

`reloadConfig` already reassigns `configState.current` on `config:changed`, so a
tray pick takes effect on the next dictation. `controller.ts` is untouched.

### 3. `config.rs` (Rust helpers)

- `const DEFAULT_TEMPLATES_JSON: &str = include_str!("../../src/config/defaultTemplates.json");`
- New pure helper, unit-testable without the filesystem:
  ```rust
  /// Returns (display_label, template_name) pairs. Prefers the config's
  /// `templates` array; falls back to parsing `default_json`.
  pub fn template_choices_from_value(
      cfg: &serde_json::Value,
      default_json: &str,
  ) -> Vec<(String, String)>
  ```
  - Source array = `cfg["templates"]` if it is a non-empty array, else the parsed
    `default_json`.
  - For each object with a string `name`: label = `icon` present ?
    `format!("{icon} {name}")` : `name.clone()`; value = `name`.
  - Objects without a string `name` are skipped.
- A thin `read_template_choices() -> Vec<(String, String)>` that reads the config
  file (or `{}`) and calls `template_choices_from_value(&cfg, DEFAULT_TEMPLATES_JSON)`.

### 4. `menu.rs` (tray submenu)

- In `build_settings_menu`, add a **"Vorlage"** submenu after Provider.
- Build it from `read_template_choices()`. Read the active name via
  `read_config_value("activeTemplate", <first template name>)`.
- Each entry is a `CheckMenuItem` with id `settmpl:<name>`, checked when
  `name == active`.
- In `handle_menu_event`, before the `set:` branch, handle `settmpl:`:
  ```rust
  if let Some(name) = id.strip_prefix("settmpl:") {
      if let Err(e) = write_config_key(
          "activeTemplate",
          serde_json::Value::String(name.to_string()),
      ) {
          eprintln!("[Verba] write_config_key failed: {e}");
      }
      rebuild_and_reload(app);
      return;
  }
  ```
  (`handle_menu_event` returns `()`, so errors are logged, not propagated —
  same pattern as the existing `set:` branch.)
  Using `strip_prefix` (not the `set:` `rsplit_once(':')` scheme) means template
  names containing any character survive intact.

## Data flow (end to end)

1. User opens tray ▸ Vorlage ▸ "Commit Message".
2. `handle_menu_event` writes `activeTemplate: "Commit Message"`, rebuilds the
   menu (checkmark moves), emits `config:changed`.
3. `main.ts` listener calls `reloadConfig()` → `loadConfig()` re-resolves
   `configState.current.activeTemplate` = the Commit Message template.
4. Next hotkey dictation: the `cleanup.process` wrapper passes
   `templatePrompt = "<commit message prompt>"`.
5. `CleanupService` builds `TEMPLATE_FRAMING + templatePrompt` and returns a
   commit-message-shaped result, pasted as usual.

## Error handling

- Malformed `config.json` or `templates` field → defaults (existing `loadConfig`
  and `read_config` both already never throw).
- `activeTemplate` naming a missing template → first template (Freitext).
- Rust JSON parse failure on either config or bundled default → the helper
  returns an empty vec for that source and falls through to the default JSON;
  the bundled JSON is compiled in and thus always valid.

## Testing

**Frontend (`verbaConfig.test.ts`):**
- `templates` absent → `DEFAULT_TEMPLATES`; `activeTemplate` = Freitext.
- Valid `templates` override → used; defaults ignored.
- `activeTemplate` names an existing template → resolved to it.
- `activeTemplate` names a missing template → first template.
- Malformed `templates` (not an array / wrong-typed entries) → defaults.
- `resolveActiveTemplate` unit cases (found / not-found / empty-name).

**Rust (`config.rs` tests):**
- `template_choices_from_value` with a config `templates` array → those labels.
- With no `templates` → default JSON labels (count == 9, first == Freitext).
- With malformed `templates` (non-array / entries missing `name`) → default JSON
  labels; bad entries skipped.

## Scope guard

No popup picker, no per-dictation switching, no `autoSelectTemplate`/`fileTypes`,
no `@verba/core` changes, no VS Code extension changes, no new image assets.
