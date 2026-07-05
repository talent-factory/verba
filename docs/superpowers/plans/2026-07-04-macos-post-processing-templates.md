# macOS Post-Processing Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the macOS menu-bar app apply a chosen post-processing template (Claude system prompt) to each dictation, picked from a persisted tray submenu, with template definitions living as config data.

**Architecture:** Template definitions ship as a bundled `defaultTemplates.json` read by both the TypeScript frontend (JSON import) and the Rust tray (`include_str!`). `config.json` gains `activeTemplate` (a name) and an optional `templates` override. `verbaConfig.ts` resolves the active `Template`; `wiring.ts` injects its `prompt` as `PipelineContext.templatePrompt` into the existing `@verba/core` `CleanupService` — which already turns that into `TEMPLATE_FRAMING + prompt`. The tray "Vorlage" submenu writes `activeTemplate` and reuses the existing `config:changed` live-reload path. No `@verba/core` or VS Code extension changes.

**Tech Stack:** TypeScript (Vite + `tsc`/mocha test build), Rust (Tauri v2, `serde_json`), `@verba/core`.

## Global Constraints

- Template prompts are **data**, never hard-coded in TS or Rust source. The single source is `apps/macos/src/config/defaultTemplates.json`.
- Default template set = the existing VS Code 9 (prompts copied verbatim from `package.json` → `verba.templates`). Default active template = **Freitext**.
- No popup picker, no per-dictation switching, no `autoSelectTemplate` / `fileTypes`, no new image assets.
- Selecting a template must apply to the next dictation with no restart (reuse `config:changed`).
- All new user-facing tray strings are German (menu title "Vorlage"), consistent with `menu.rs`.
- Commit messages: German, emoji Conventional Commits, **no** `Co-Authored-By`/`Generated with` footers (project convention in `git-workflow:commit`).
- All commits go through the `/git-workflow:commit` skill per project preference; stage only the files listed in each task's commit step.

---

## File Structure

**Create:**
- `apps/macos/src/config/defaultTemplates.json` — the 9 default templates (single source, read by TS + Rust).

**Modify:**
- `apps/macos/tsconfig.json` — enable `resolveJsonModule`.
- `apps/macos/src/config/verbaConfig.ts` — `Template` type, defaults import, validation, active-template resolution, cleanup-context helper.
- `apps/macos/src/test/unit/verbaConfig.test.ts` — tests for the above.
- `apps/macos/src/wiring.ts` — inject `templatePrompt` via the new helper.
- `apps/macos/src-tauri/src/config.rs` — `template_choices_from_value` + `read_template_choices` + tests.
- `apps/macos/src-tauri/src/menu.rs` — "Vorlage" submenu + `settmpl:` click handler.

---

## Task 1: Default templates data + frontend resolution

**Files:**
- Create: `apps/macos/src/config/defaultTemplates.json`
- Modify: `apps/macos/tsconfig.json`
- Modify: `apps/macos/src/config/verbaConfig.ts`
- Test: `apps/macos/src/test/unit/verbaConfig.test.ts`

**Interfaces:**
- Produces (used by Task 2 and Task 3/4 data contract):
  - `export interface Template { name: string; prompt: string; icon?: string; contextAware?: boolean }`
  - `export const DEFAULT_TEMPLATES: Template[]`
  - `ResolvedConfig` gains `templates: Template[]` and `activeTemplate: Template`
  - `export function resolveActiveTemplate(templates: Template[], name?: string): Template`
- The JSON shape (array of `{ name, prompt, icon?, contextAware? }`) is the contract Rust parses in Task 3.

- [ ] **Step 1: Create the default templates JSON**

Create `apps/macos/src/config/defaultTemplates.json` with exactly these 9 entries (prompts copied verbatim from `package.json` → `verba.templates`; `fileTypes` dropped; emoji `icon` added for the tray label):

```json
[
  {
    "name": "Freitext",
    "icon": "✏️",
    "prompt": "Clean up the transcript: remove filler words (um, uh, like, you know, halt, eigentlich, sozusagen, quasi), smooth broken or repeated sentence starts, fix obvious transcription errors. Keep the original language and meaning exactly. Return only the cleaned text without explanation."
  },
  {
    "name": "Commit Message",
    "icon": "🔀",
    "prompt": "Convert this transcript into a Git commit message following Conventional Commits format. First line: type(scope): short description. Optional body after blank line for details. Keep the original language. Return only the commit message without explanation."
  },
  {
    "name": "JavaDoc",
    "icon": "☕",
    "prompt": "Convert this transcript into a JavaDoc comment block (/** ... */). Structure with @param, @return, @throws tags as appropriate based on the described function. Keep the original language. Return only the JavaDoc block without explanation."
  },
  {
    "name": "Markdown",
    "icon": "📖",
    "prompt": "Convert this transcript into well-structured Markdown text. Use headings, bullet lists, numbered lists, and emphasis as appropriate. Keep the original language. Return only the Markdown without explanation."
  },
  {
    "name": "E-Mail",
    "icon": "📧",
    "prompt": "Convert this transcript into a professional email with appropriate greeting and closing. Maintain the original language and intended tone (formal or informal). Return only the email text without explanation."
  },
  {
    "name": "Code Comment",
    "icon": "📝",
    "contextAware": true,
    "prompt": "Generate a precise code comment based on the transcript and the provided code context. Choose the appropriate format (inline comment, JSDoc, Docstring) based on the programming language. Return ONLY the comment."
  },
  {
    "name": "Explain Code",
    "icon": "💡",
    "contextAware": true,
    "prompt": "Explain the code based on the question in the transcript and the provided code context. Answer concisely and technically in the language of the transcript. Return ONLY the explanation."
  },
  {
    "name": "Claude Code Prompt",
    "icon": "🤖",
    "contextAware": true,
    "prompt": "Convert this transcript into a precise, well-structured prompt for a Claude Code agent. Use the provided code context to reference specific files, classes, and functions by name. Structure the prompt as a clear task description: what to do, where in the codebase, and any constraints. Keep the original language. Return ONLY the prompt text, ready to paste into a terminal."
  },
  {
    "name": "Transform Selection",
    "icon": "🔧",
    "prompt": "The user has selected text in their editor (provided in <selection> tags) and dictated an instruction (in <transcript> tags). Apply the spoken instruction to transform the selected text. Examples: translate it, rewrite it, add comments, simplify it, fix it, etc. Return ONLY the transformed text that should replace the selection — no explanation, no preamble."
  }
]
```

- [ ] **Step 2: Enable JSON imports in tsconfig**

Modify `apps/macos/tsconfig.json` — add `"resolveJsonModule": true` to `compilerOptions` (needed so both `tsc --noEmit` and the `tsconfig.test.json` build accept the JSON import; the test build emits the JSON next to the compiled JS so `require('./defaultTemplates.json')` resolves at runtime):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing tests**

Append these tests to `apps/macos/src/test/unit/verbaConfig.test.ts`. Add the import at the top of the file next to the existing `loadConfig` import:

```typescript
import { loadConfig, resolveActiveTemplate, DEFAULT_TEMPLATES } from '../../config/verbaConfig';
```

Then add a new suite (keep the existing `loadConfig` suite as-is):

```typescript
suite('templates', () => {
	test('defaults to the 9 bundled templates when config has none', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		assert.strictEqual(cfg.templates.length, 9);
		assert.strictEqual(cfg.templates[0].name, 'Freitext');
		assert.strictEqual(cfg.activeTemplate.name, 'Freitext');
	});

	test('a valid templates array replaces the defaults', async () => {
		const raw = JSON.stringify({
			templates: [{ name: 'Custom', prompt: 'do the thing' }],
		});
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 1);
		assert.strictEqual(cfg.templates[0].name, 'Custom');
		assert.strictEqual(cfg.activeTemplate.name, 'Custom');
	});

	test('activeTemplate selects the named template', async () => {
		const raw = JSON.stringify({ activeTemplate: 'E-Mail' });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.activeTemplate.name, 'E-Mail');
	});

	test('activeTemplate naming a missing template falls back to the first', async () => {
		const raw = JSON.stringify({ activeTemplate: 'Nonexistent' });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.activeTemplate.name, 'Freitext');
	});

	test('malformed templates fall back to the defaults', async () => {
		const raw = JSON.stringify({ templates: [{ name: 'NoPrompt' }, 'nope'] });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 9);
	});

	test('resolveActiveTemplate returns the first template when name is undefined', () => {
		const t = resolveActiveTemplate(DEFAULT_TEMPLATES, undefined);
		assert.strictEqual(t.name, 'Freitext');
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm --workspace apps/macos run test:unit`
Expected: FAIL — `resolveActiveTemplate`/`DEFAULT_TEMPLATES` not exported and `cfg.templates`/`cfg.activeTemplate` undefined (compile error or assertion failures).

- [ ] **Step 5: Implement the resolution in `verbaConfig.ts`**

Edit `apps/macos/src/config/verbaConfig.ts`:

(a) Add the JSON import and template type at the top, after the existing imports:

```typescript
import defaultTemplatesData from './defaultTemplates.json';

/** A post-processing template: the Claude system prompt plus tray display metadata. */
export interface Template {
	name: string;
	prompt: string;
	icon?: string;
	contextAware?: boolean;
}

/** The bundled default templates (single source, shared with the Rust tray). */
export const DEFAULT_TEMPLATES: Template[] = defaultTemplatesData as Template[];
```

(b) Extend the raw `VerbaConfig` interface — replace `templates?: unknown[]; autoSelectTemplate?: boolean;` with:

```typescript
	templates?: unknown[];
	activeTemplate?: string;
```

(c) Extend `ResolvedConfig` — add these two fields:

```typescript
	templates: Template[];
	activeTemplate: Template;
```

(d) Add the validator and resolver near the other `isX` helpers:

```typescript
function isTemplateArray(v: unknown): v is Template[] {
	return Array.isArray(v) && v.length > 0 && v.every(
		(x) => !!x && typeof x === 'object'
			&& nonEmptyString((x as Template).name)
			&& typeof (x as Template).prompt === 'string',
	);
}

/** Returns the template named `name`, or the first template when unnamed/unknown. */
export function resolveActiveTemplate(templates: Template[], name?: string): Template {
	const found = name ? templates.find((t) => t.name === name) : undefined;
	return found ?? templates[0];
}
```

(e) In `loadConfig`, add the two resolved fields to the returned object (alongside the existing ones):

```typescript
		templates: isTemplateArray(raw.templates) ? raw.templates : DEFAULT_TEMPLATES,
		activeTemplate: resolveActiveTemplate(
			isTemplateArray(raw.templates) ? raw.templates : DEFAULT_TEMPLATES,
			raw.activeTemplate,
		),
```

(f) `DEFAULTS`, `ApplyTargets`, and `applyConfig` are unchanged — templates are read at process-time, not pushed into a stateful service.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --workspace apps/macos run test:unit`
Expected: PASS — all existing `loadConfig` tests plus the 6 new `templates` tests.

- [ ] **Step 7: Typecheck the production build path**

Run: `npm --workspace apps/macos run typecheck`
Expected: exits 0 (confirms `resolveJsonModule` lets `tsc --noEmit` accept the JSON import).

- [ ] **Step 8: Commit**

Use the `/git-workflow:commit` skill, staging only:
```
apps/macos/src/config/defaultTemplates.json
apps/macos/tsconfig.json
apps/macos/src/config/verbaConfig.ts
apps/macos/src/test/unit/verbaConfig.test.ts
```
Suggested message: `✨ feat(macos): Post-Processing-Templates als Config-Daten (Default-JSON + Auflösung)`

---

## Task 2: Inject the active template's prompt into cleanup

**Files:**
- Modify: `apps/macos/src/config/verbaConfig.ts`
- Modify: `apps/macos/src/wiring.ts`
- Test: `apps/macos/src/test/unit/verbaConfig.test.ts`

**Interfaces:**
- Consumes (from Task 1): `ResolvedConfig.activeTemplate: Template`, `ResolvedConfig.language`.
- Produces: `export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext` — merges the active template's prompt (and, when not `'auto'`, the config language) into the pipeline context. `wiring.ts` calls it in the `cleanup.process` wrapper.

- [ ] **Step 1: Write the failing tests**

Add `PipelineContext` to the core import at the top of `apps/macos/src/test/unit/verbaConfig.test.ts` is not needed; instead extend the top import from verbaConfig and add a suite. Add `cleanupContextFor` to the existing verbaConfig import line:

```typescript
import { loadConfig, resolveActiveTemplate, DEFAULT_TEMPLATES, cleanupContextFor } from '../../config/verbaConfig';
```

Add this suite:

```typescript
suite('cleanupContextFor', () => {
	test('sets templatePrompt from the active template', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		const ctx = cleanupContextFor(cfg, { detectedLanguage: 'de' });
		assert.strictEqual(ctx.templatePrompt, DEFAULT_TEMPLATES[0].prompt);
		// language 'auto' → keep the transcription-detected language
		assert.strictEqual(ctx.detectedLanguage, 'de');
	});

	test('overrides detectedLanguage when config language is not auto', async () => {
		const cfg = await loadConfig(sinon.stub().resolves(JSON.stringify({ language: 'en' })));
		const ctx = cleanupContextFor(cfg, { detectedLanguage: 'de' });
		assert.strictEqual(ctx.detectedLanguage, 'en');
	});

	test('works with no incoming context', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		const ctx = cleanupContextFor(cfg, undefined);
		assert.strictEqual(ctx.templatePrompt, DEFAULT_TEMPLATES[0].prompt);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace apps/macos run test:unit`
Expected: FAIL — `cleanupContextFor` is not exported.

- [ ] **Step 3: Implement `cleanupContextFor` in `verbaConfig.ts`**

Add `PipelineContext` to the core import at the top of `verbaConfig.ts`:

```typescript
import type { Expansion, PipelineContext } from '@verba/core';
```

Add the helper (after `applyConfig`):

```typescript
/**
 * Builds the pipeline context for a dictation: injects the active template's
 * prompt, and pins the cleanup language when the user chose a fixed one
 * (otherwise the transcription-detected language on `context` is kept).
 */
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext {
	const merged: PipelineContext = { ...context, templatePrompt: config.activeTemplate.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	return merged;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace apps/macos run test:unit`
Expected: PASS — the 3 new `cleanupContextFor` tests plus all prior tests.

- [ ] **Step 5: Use the helper in `wiring.ts`**

In `apps/macos/src/wiring.ts`, update the import and the `cleanup.process` wrapper.

Change the config import line:

```typescript
import { loadConfig, applyConfig, cleanupContextFor } from './config/verbaConfig';
```

Replace the `cleanup` block in the `DictationController` construction:

```typescript
		cleanup: {
			process: (transcript, context) =>
				cleanup.process(transcript, cleanupContextFor(configState.current, context)),
		},
```

(The old inline `configState.current.language !== 'auto' ? … : …` ternary is now inside `cleanupContextFor`.)

- [ ] **Step 6: Typecheck**

Run: `npm --workspace apps/macos run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

Use `/git-workflow:commit`, staging only:
```
apps/macos/src/config/verbaConfig.ts
apps/macos/src/wiring.ts
apps/macos/src/test/unit/verbaConfig.test.ts
```
Suggested message: `✨ feat(macos): aktive Vorlage als templatePrompt in den Cleanup-Kontext einspeisen`

---

## Task 3: Rust template-choices helper

**Files:**
- Modify: `apps/macos/src-tauri/src/config.rs`

**Interfaces:**
- Consumes: `apps/macos/src/config/defaultTemplates.json` (via `include_str!`), the JSON shape from Task 1.
- Produces (used by Task 4):
  - `pub fn template_choices_from_value(cfg: &serde_json::Value, default_json: &str) -> Vec<(String, String)>` — `(label, name)` pairs.
  - `pub fn read_template_choices() -> Vec<(String, String)>`.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `#[cfg(test)] mod tests` block in `apps/macos/src-tauri/src/config.rs`:

```rust
    #[test]
    fn template_choices_uses_config_templates_when_present() {
        let cfg = serde_json::json!({
            "templates": [ { "name": "Custom", "prompt": "x", "icon": "🎯" } ]
        });
        let choices = template_choices_from_value(&cfg, DEFAULT_TEMPLATES_JSON);
        assert_eq!(choices, vec![("🎯 Custom".to_string(), "Custom".to_string())]);
    }

    #[test]
    fn template_choices_falls_back_to_bundled_defaults() {
        let choices = template_choices_from_value(&serde_json::json!({}), DEFAULT_TEMPLATES_JSON);
        assert_eq!(choices.len(), 9);
        assert_eq!(choices[0].1, "Freitext");
        assert_eq!(choices[0].0, "✏️ Freitext");
    }

    #[test]
    fn template_choices_ignores_non_array_and_skips_nameless_entries() {
        // non-array templates → defaults
        let bad = serde_json::json!({ "templates": "nope" });
        assert_eq!(template_choices_from_value(&bad, DEFAULT_TEMPLATES_JSON).len(), 9);
        // entries without a string name are skipped
        let mixed = serde_json::json!({
            "templates": [ { "prompt": "no name" }, { "name": "Ok", "prompt": "y" } ]
        });
        let choices = template_choices_from_value(&mixed, DEFAULT_TEMPLATES_JSON);
        assert_eq!(choices, vec![("Ok".to_string(), "Ok".to_string())]);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/macos/src-tauri && cargo test template_choices 2>&1 | tail -20`
Expected: FAIL to compile — `template_choices_from_value` and `DEFAULT_TEMPLATES_JSON` are undefined.

- [ ] **Step 3: Implement the helpers in `config.rs`**

Add near the top of `apps/macos/src-tauri/src/config.rs` (after the `use` line):

```rust
/// The bundled default templates — the same file the frontend imports.
pub const DEFAULT_TEMPLATES_JSON: &str = include_str!("../../src/config/defaultTemplates.json");
```

Add these functions (e.g. after `read_config_value`):

```rust
/// Returns `(label, name)` pairs for the tray "Vorlage" submenu. Prefers the
/// config's `templates` array; when that is absent, empty, or not an array,
/// falls back to parsing `default_json`. Entries without a string `name` are
/// skipped; `label` prefixes the emoji `icon` when present.
pub fn template_choices_from_value(
    cfg: &serde_json::Value,
    default_json: &str,
) -> Vec<(String, String)> {
    let arr: Vec<serde_json::Value> = match cfg.get("templates").and_then(|v| v.as_array()) {
        Some(a) if !a.is_empty() => a.clone(),
        _ => serde_json::from_str(default_json).unwrap_or_default(),
    };
    arr.iter()
        .filter_map(|t| {
            let name = t.get("name").and_then(|n| n.as_str())?;
            let label = match t.get("icon").and_then(|i| i.as_str()) {
                Some(icon) if !icon.is_empty() => format!("{icon} {name}"),
                _ => name.to_string(),
            };
            Some((label, name.to_string()))
        })
        .collect()
}

/// Reads the config file (or `{}`) and returns the tray template choices.
pub fn read_template_choices() -> Vec<(String, String)> {
    let cfg: serde_json::Value = config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    template_choices_from_value(&cfg, DEFAULT_TEMPLATES_JSON)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/macos/src-tauri && cargo test template_choices 2>&1 | tail -20`
Expected: PASS — 3 new tests (plus existing config tests unaffected).

- [ ] **Step 5: Commit**

Use `/git-workflow:commit`, staging only:
```
apps/macos/src-tauri/src/config.rs
```
Suggested message: `✨ feat(macos): Rust-Helfer für Tray-Vorlagenliste (Config-Override + Default-JSON)`

---

## Task 4: Tray "Vorlage" submenu

**Files:**
- Modify: `apps/macos/src-tauri/src/menu.rs`

**Interfaces:**
- Consumes (from Task 3): `read_template_choices()`, and the existing `read_config_value`, `write_config_key`, `config_path` from `crate::config`.
- Produces: user-visible tray submenu; on click writes `activeTemplate` and emits `config:changed` (consumed by the existing `main.ts` listener → `reloadConfig`).

- [ ] **Step 1: Extend the config import**

In `apps/macos/src-tauri/src/menu.rs`, update the `use crate::config` line to include the new helper:

```rust
use crate::config::{config_path, read_config_value, read_template_choices, write_config_key};
```

- [ ] **Step 2: Build the "Vorlage" submenu in `build_settings_menu`**

In `build_settings_menu`, after the `provider` submenu is built and before the `sep` line, add:

```rust
    let template_choices = read_template_choices();
    let default_active = template_choices
        .first()
        .map(|(_, name)| name.clone())
        .unwrap_or_default();
    let active = read_config_value("activeTemplate", &default_active);
    let template_items: Vec<CheckMenuItem<Wry>> = template_choices
        .iter()
        .map(|(label, name)| {
            CheckMenuItem::with_id(
                app,
                format!("settmpl:{name}"),
                label.as_str(),
                true,
                *name == active,
                None::<&str>,
            )
        })
        .collect::<Result<_, _>>()?;
    let template = submenu(app, "Vorlage", &template_items)?;
```

Then add `&template` to the `Menu::with_items` call, after `&provider`:

```rust
    Menu::with_items(
        app,
        &[&transcription, &cleanup, &provider, &template, &sep, &open, &reload, &quit],
    )
```

- [ ] **Step 3: Handle the `settmpl:` click in `handle_menu_event`**

In `handle_menu_event`, replace the `other => { … }` arm body so it handles `settmpl:` before the existing `set:` branch:

```rust
        other => {
            if let Some(name) = other.strip_prefix("settmpl:") {
                if let Err(e) = write_config_key(
                    "activeTemplate",
                    serde_json::Value::String(name.to_string()),
                ) {
                    eprintln!("[Verba] write_config_key failed: {e}");
                }
                rebuild_and_reload(app);
            } else if let Some(rest) = other.strip_prefix("set:") {
                // rsplit at the LAST ':' so dotted keys survive (e.g. transcription.language:de)
                if let Some((key, value)) = rest.rsplit_once(':') {
                    if let Err(e) = write_config_key(key, serde_json::Value::String(value.to_string())) {
                        eprintln!("[Verba] write_config_key failed: {e}");
                    }
                    rebuild_and_reload(app);
                }
            }
        }
```

- [ ] **Step 4: Verify it compiles and existing Rust tests pass**

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -20 && cargo test 2>&1 | tail -20`
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Manual smoke test**

Run: `npm --workspace apps/macos run tauri dev` (from repo root), then:
1. Open the tray menu → confirm a **Vorlage** submenu lists all 9 templates with emoji, **Freitext** checked.
2. Pick **E-Mail** → the checkmark moves to E-Mail.
3. Inspect `~/.config/verba/config.json` → it contains `"activeTemplate": "E-Mail"`.
4. Dictate a short sentence → the pasted result is shaped like an email (greeting/closing), confirming the prompt reached Claude.
5. Pick **Freitext** again → next dictation returns to plain cleanup.

- [ ] **Step 6: Commit**

Use `/git-workflow:commit`, staging only:
```
apps/macos/src-tauri/src/menu.rs
```
Suggested message: `✨ feat(macos): Tray-Vorlagenmenü — aktive Vorlage wählen (schreibt activeTemplate, config:changed)`

---

## Self-Review

**Spec coverage:**
- Single source `defaultTemplates.json` (spec §"Single source of truth") → Task 1 Step 1; Rust `include_str!` → Task 3 Step 3. ✓
- Config schema `activeTemplate` + `templates` (spec §"Config schema") → Task 1 Steps 5b/5e. ✓
- `Template` type, `ResolvedConfig` fields, `isTemplateArray`, `resolveActiveTemplate` (spec §Component 1) → Task 1 Step 5. ✓
- `applyConfig` unchanged (spec §Component 1) → Task 1 Step 5f. ✓
- `wiring.ts` injects `templatePrompt`; controller untouched; reuses `config:changed` (spec §Component 2) → Task 2 Steps 3/5. ✓
- `config.rs` `template_choices_from_value` + `read_template_choices` (spec §Component 3) → Task 3. ✓
- `menu.rs` "Vorlage" submenu, `settmpl:` ids via `strip_prefix`, `rebuild_and_reload` (spec §Component 4) → Task 4. ✓
- Error handling: malformed config → defaults (spec §"Error handling") → Task 1 "malformed" test, Task 3 "non_array" test. ✓
- Testing plan (spec §Testing) → Task 1 (6 tests), Task 2 (3 tests), Task 3 (3 tests), Task 4 manual. ✓
- Dropped `autoSelectTemplate`/`fileTypes` (spec Non-Goals) → Task 1 Step 5b removes `autoSelectTemplate` from the raw type; `fileTypes` absent from JSON. ✓
- No `@verba/core` / VS Code changes (spec Scope guard) → no such files in the File Structure. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**Type consistency:** `Template`/`DEFAULT_TEMPLATES`/`resolveActiveTemplate`/`cleanupContextFor` names are identical across Tasks 1–2 and their tests. `template_choices_from_value`/`read_template_choices`/`DEFAULT_TEMPLATES_JSON` identical across Tasks 3–4. `(label, name)` tuple order consistent (label first). `settmpl:` prefix identical in Task 4 Steps 2 and 3. ✓
