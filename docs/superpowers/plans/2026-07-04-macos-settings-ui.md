# macOS Settings UI (Sub-Project B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A menu-bar tray submenu to change the wired, menu-suitable settings (transcription language, cleanup language, provider) that writes `~/.config/verba/config.json` and applies live on the next dictation — no restart.

**Architecture:** Rust owns the menu: it writes the config file and, on any change, rebuilds the menu (so checkmarks reflect the file) and emits `config:changed`. The frontend listens and calls `reloadConfig`, which re-reads the file and re-applies it to the running provider/cleanup. No `CheckMenuItem` handles are stored — the menu is rebuilt on change.

**Tech Stack:** Rust (Tauri v2 menu/tray, serde_json), TypeScript (Vite/Tauri), mocha (TDD) + sinon.

## Global Constraints

- Scope `apps/macos` only. `packages/core` and the VS Code extension untouched.
- Config file `~/.config/verba/config.json` (XDG), reusing A's `config_path()`.
- Menu changes write the file (JSON pretty round-trip; **comments are lost**), then apply live (next dictation) — no restart.
- Malformed/absent config on write → treat as `{}` (overwritten with valid JSON).
- Only wired + menu-suitable settings appear: `transcription.language`, `language`, `transcription.provider` (Local disabled). No `templates`/`autoSelectTemplate`/`audioDevice`.
- Menu item id scheme: `set:<dotted.key>:<value>`, plus `open-config`, `reload-config`, `quit`.
- All apply/reload is best-effort: caught/logged, never breaks the flow.
- Tests: mocha TDD (`suite`/`test`/`setup`), sinon, `assert`; `cd apps/macos && npm run test:unit`. Rust: `cd apps/macos/src-tauri && cargo test <name>` / `cargo build`.

---

## File Structure

- Modify `apps/macos/src-tauri/src/config.rs` — `set_json_key`, `write_config_key`, `read_config_value`; make `config_path` `pub(crate)` (Task 1).
- Create `apps/macos/src-tauri/src/menu.rs` — settings menu build + event handler (Task 2).
- Modify `apps/macos/src-tauri/src/lib.rs` — use the settings menu + route events (Task 2).
- Modify `apps/macos/src/deepgramTauriProvider.ts` + its test — `setLanguage` (Task 3).
- Modify `apps/macos/src/config/verbaConfig.ts` + create `apps/macos/src/test/unit/applyConfig.test.ts` — `applyConfig` (Task 4).
- Modify `apps/macos/src/wiring.ts` + `apps/macos/src/main.ts` — live reload wiring (Task 4).

---

### Task 1: Rust config write helpers

**Files:**
- Modify: `apps/macos/src-tauri/src/config.rs`

**Interfaces:**
- Produces: `pub fn set_json_key(root: &mut serde_json::Value, dotted: &str, value: serde_json::Value)`; `pub fn write_config_key(dotted: &str, value: serde_json::Value) -> Result<(), String>`; `pub fn read_config_value(dotted: &str, default: &str) -> String`; and `config_path` becomes `pub(crate)`.

- [ ] **Step 1: Add the functions**

In `apps/macos/src-tauri/src/config.rs`, change the existing `fn config_path()` signature to `pub(crate) fn config_path()` (body unchanged). Then add, above the `#[cfg(test)]` module:

```rust
/// Sets `dotted` (e.g. `"transcription.language"`) to `value` inside `root`,
/// creating intermediate objects and coercing non-object levels to objects.
pub fn set_json_key(root: &mut serde_json::Value, dotted: &str, value: serde_json::Value) {
    if !root.is_object() {
        *root = serde_json::json!({});
    }
    let parts: Vec<&str> = dotted.split('.').collect();
    let mut cur = root;
    for part in &parts[..parts.len() - 1] {
        let obj = cur.as_object_mut().expect("coerced to object above/below");
        let entry = obj
            .entry((*part).to_string())
            .or_insert_with(|| serde_json::json!({}));
        if !entry.is_object() {
            *entry = serde_json::json!({});
        }
        cur = entry;
    }
    if let Some(obj) = cur.as_object_mut() {
        obj.insert(parts[parts.len() - 1].to_string(), value);
    }
}

/// Reads the config file (or `{}`), sets `dotted` to `value`, and writes the
/// result back as pretty JSON (creating `~/.config/verba/` if needed). Comments
/// in the original file are lost (JSON round-trip).
pub fn write_config_key(dotted: &str, value: serde_json::Value) -> Result<(), String> {
    let path = config_path().ok_or_else(|| "no HOME/XDG_CONFIG_HOME".to_string())?;
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    set_json_key(&mut root, dotted, value);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty).map_err(|e| e.to_string())
}

/// Returns the string at `dotted` in the config file, or `default` if the file
/// is absent/malformed or the key is missing/not-a-string.
pub fn read_config_value(dotted: &str, default: &str) -> String {
    let root: serde_json::Value = config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let mut cur = &root;
    for part in dotted.split('.') {
        match cur.get(part) {
            Some(v) => cur = v,
            None => return default.to_string(),
        }
    }
    cur.as_str().unwrap_or(default).to_string()
}
```

- [ ] **Step 2: Add tests for `set_json_key`**

In the existing `#[cfg(test)] mod tests` block in `config.rs`, add:

```rust
    #[test]
    fn set_json_key_creates_nested_object() {
        let mut v = serde_json::json!({});
        set_json_key(&mut v, "transcription.language", serde_json::json!("de"));
        assert_eq!(v, serde_json::json!({ "transcription": { "language": "de" } }));
    }

    #[test]
    fn set_json_key_overwrites_existing_leaf_and_preserves_siblings() {
        let mut v = serde_json::json!({ "language": "auto", "glossary": ["x"] });
        set_json_key(&mut v, "language", serde_json::json!("de"));
        assert_eq!(v, serde_json::json!({ "language": "de", "glossary": ["x"] }));
    }

    #[test]
    fn set_json_key_coerces_non_object_root() {
        let mut v = serde_json::json!(5);
        set_json_key(&mut v, "a.b", serde_json::json!("x"));
        assert_eq!(v, serde_json::json!({ "a": { "b": "x" } }));
    }
```

- [ ] **Step 3: Run tests + build**

Run: `cd apps/macos/src-tauri && cargo test config:: 2>&1 | tail -15` → the three `set_json_key_*` tests (plus the existing config tests) pass.
Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -8` → `Finished`, no warnings. (`set_json_key`/`write_config_key`/`read_config_value` are `pub` and used by menu.rs in Task 2; if the compiler warns "never used" here, that is expected until Task 2 — but since they are `pub`, no dead-code warning fires.)

- [ ] **Step 4: Commit**

```bash
git add apps/macos/src-tauri/src/config.rs
git commit -m "✨ feat(macos): config.rs — set_json_key/write_config_key/read_config_value"
```

---

### Task 2: Settings menu (Rust)

**Files:**
- Create: `apps/macos/src-tauri/src/menu.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `read_config_value`, `write_config_key` (Task 1).
- Produces: `pub fn build_settings_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error>` and `pub fn handle_menu_event(app: &AppHandle, id: &str)`.

- [ ] **Step 1: Write `menu.rs`**

Create `apps/macos/src-tauri/src/menu.rs`:

```rust
//! The tray settings menu. On any change it writes the config file, rebuilds
//! the menu (so checkmarks reflect the file), and emits `config:changed` so the
//! frontend re-applies the settings live. No menu-item handles are stored —
//! the menu is cheap to rebuild.

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

use crate::config::{config_path, read_config_value, write_config_key};

// (label, value, enabled)
const TRANSCRIPTION_LANGS: &[(&str, &str, bool)] = &[
    ("Auto / Mehrsprachig", "multi", true),
    ("Deutsch", "de", true),
    ("English", "en", true),
    ("Français", "fr", true),
    ("Español", "es", true),
    ("Italiano", "it", true),
    ("Nederlands", "nl", true),
    ("Português", "pt", true),
];
const CLEANUP_LANGS: &[(&str, &str, bool)] = &[
    ("Automatisch", "auto", true),
    ("Deutsch", "de", true),
    ("English", "en", true),
    ("Français", "fr", true),
    ("Español", "es", true),
    ("Italiano", "it", true),
    ("Nederlands", "nl", true),
    ("Português", "pt", true),
];
const PROVIDERS: &[(&str, &str, bool)] = &[
    ("Deepgram", "deepgram", true),
    ("Lokal – whisper.cpp", "local", false),
];

fn check_items(
    app: &AppHandle,
    key: &str,
    default: &str,
    opts: &[(&str, &str, bool)],
) -> Result<Vec<CheckMenuItem<Wry>>, tauri::Error> {
    let current = read_config_value(key, default);
    opts.iter()
        .map(|(label, value, enabled)| {
            CheckMenuItem::with_id(
                app,
                format!("set:{key}:{value}"),
                *label,
                *enabled,
                *value == current,
                None::<&str>,
            )
        })
        .collect()
}

fn submenu(app: &AppHandle, title: &str, items: &[CheckMenuItem<Wry>]) -> Result<Submenu<Wry>, tauri::Error> {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, title, true, &refs)
}

/// Builds the full tray menu, with checkmarks reflecting the current config.
pub fn build_settings_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let t = check_items(app, "transcription.language", "multi", TRANSCRIPTION_LANGS)?;
    let c = check_items(app, "language", "auto", CLEANUP_LANGS)?;
    let p = check_items(app, "transcription.provider", "deepgram", PROVIDERS)?;

    let transcription = submenu(app, "Transkriptionssprache", &t)?;
    let cleanup = submenu(app, "Cleanup-Sprache (Claude)", &c)?;
    let provider = submenu(app, "Provider", &p)?;

    let sep = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, "open-config", "Konfiguration öffnen…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload-config", "Konfiguration neu laden", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Verba", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[&transcription, &cleanup, &provider, &sep, &open, &reload, &quit],
    )
}

/// Handles a tray menu click.
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "quit" => {
            app.exit(0);
        }
        "open-config" => open_config(),
        "reload-config" => rebuild_and_reload(app),
        other => {
            if let Some(rest) = other.strip_prefix("set:") {
                // rsplit at the LAST ':' so dotted keys survive (e.g. transcription.language:de)
                if let Some((key, value)) = rest.rsplit_once(':') {
                    if let Err(e) = write_config_key(key, serde_json::Value::String(value.to_string())) {
                        eprintln!("[Verba] write_config_key failed: {e}");
                    }
                    rebuild_and_reload(app);
                }
            }
        }
    }
}

/// Rebuilds the tray menu (updated checkmarks) and tells the frontend to reload.
fn rebuild_and_reload(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("verba-tray") {
        if let Ok(menu) = build_settings_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    let _ = app.emit("config:changed", ());
}

/// Ensures the config file exists (creating an empty one) and opens it.
fn open_config() {
    let Some(path) = config_path() else { return };
    if !path.exists() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, "{}\n");
    }
    let _ = std::process::Command::new("open").arg(&path).status();
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Add `mod menu;` to the module list (keep sorted: after `mod hud;`, before `mod paste;`). In `setup`, replace:

```rust
            let quit = MenuItem::with_id(app, "quit", "Quit Verba", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
```

with:

```rust
            let menu = menu::build_settings_menu(app)?;
```

and replace the tray's `.on_menu_event(...)` closure (the one that checks `event.id.as_ref() == "quit"`) with:

```rust
                .on_menu_event(|app, event| menu::handle_menu_event(app, event.id.as_ref()))
```

Remove now-unused imports if the compiler flags them (e.g. `MenuItem` may no longer be used in `lib.rs`; keep `Menu`/`MenuItem` only if still referenced — let the build tell you and delete unused ones).

- [ ] **Step 3: Build**

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -20`
Expected: `Finished`, no errors, no warnings. If a Tauri v2 menu API differs (e.g. `Submenu::with_items` arg shape, `CheckMenuItem::with_id` arity, `tray.set_menu`), fix to the compiler-indicated signature and note the change — the intent (submenus of check items, rebuild-on-change, emit `config:changed`) must be preserved.

- [ ] **Step 4: Commit**

```bash
git add apps/macos/src-tauri/src/menu.rs apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): Tray-Settings-Menü (Sprachen/Provider, schreibt Config, config:changed)"
```

---

### Task 3: `DeepgramTauriProvider.setLanguage` (TypeScript, TDD)

**Files:**
- Modify: `apps/macos/src/deepgramTauriProvider.ts`
- Test: `apps/macos/src/test/unit/deepgramTauriProvider.test.ts`

**Interfaces:**
- Produces: `DeepgramTauriProvider.setLanguage(language: string): void`; subsequent `transcribe` calls use the new language.

- [ ] **Step 1: Write the failing test**

Add inside the existing `suite('DeepgramTauriProvider', …)`:

```ts
	test('setLanguage changes the language used by the next transcribe', async () => {
		invoke.resolves({ text: 'hi' });
		provider.setLanguage('de');
		await provider.transcribe('/tmp/rec.wav');
		assert.strictEqual(invoke.firstCall.args[1].language, 'de');
	});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/macos && npm run test:unit -- --grep "setLanguage changes"`
Expected: FAIL — `provider.setLanguage is not a function`.

- [ ] **Step 3: Implement**

In `apps/macos/src/deepgramTauriProvider.ts`, change the `language` field from `private readonly language: string;` to `private language: string;` and add a method (place it next to `transcribe`):

```ts
	/** Updates the Deepgram language used by subsequent transcriptions. */
	setLanguage(language: string): void {
		this.language = language;
	}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/macos && npm run test:unit -- --grep "setLanguage"`
Expected: PASS (the new test plus the existing language tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/macos && npm run typecheck` → clean.

```bash
git add apps/macos/src/deepgramTauriProvider.ts apps/macos/src/test/unit/deepgramTauriProvider.test.ts
git commit -m "✨ feat(macos): DeepgramTauriProvider.setLanguage für Live-Sprachwechsel"
```

---

### Task 4: Live reload wiring (`applyConfig`, `reloadConfig`, main listener)

**Files:**
- Modify: `apps/macos/src/config/verbaConfig.ts`
- Test: `apps/macos/src/test/unit/applyConfig.test.ts`
- Modify: `apps/macos/src/wiring.ts`
- Modify: `apps/macos/src/main.ts`

**Interfaces:**
- Consumes: `ResolvedConfig`, `Expansion`, `loadConfig` (A); `DeepgramTauriProvider.setLanguage` (Task 3); the Rust `config:changed` event (Task 2).
- Produces: `applyConfig(config: ResolvedConfig, targets: ApplyTargets): void`; `createDictationController()` now returns `Promise<{ controller: DictationController; reloadConfig: () => Promise<void> }>`.

- [ ] **Step 1: Write the failing `applyConfig` test**

Create `apps/macos/src/test/unit/applyConfig.test.ts`:

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';

import { applyConfig } from '../../config/verbaConfig';

suite('applyConfig', () => {
	test('applies transcription language, glossary, and expansions to the targets', () => {
		const targets = {
			setLanguage: sinon.stub(),
			setGlossary: sinon.stub(),
			setExpansions: sinon.stub(),
		};
		applyConfig(
			{ transcriptionLanguage: 'de', language: 'auto', glossary: ['Verba'], expansions: [{ abbreviation: 'z', expansion: 'zum Beispiel' }] },
			targets,
		);
		assert.ok(targets.setLanguage.calledOnceWith('de'));
		assert.ok(targets.setGlossary.calledOnceWith(['Verba']));
		assert.ok(targets.setExpansions.calledOnceWith([{ abbreviation: 'z', expansion: 'zum Beispiel' }]));
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/macos && npm run test:unit -- --grep applyConfig`
Expected: FAIL — `applyConfig` is not exported.

- [ ] **Step 3: Add `applyConfig` to `verbaConfig.ts`**

Append to `apps/macos/src/config/verbaConfig.ts`:

```ts
/** The mutable sinks a resolved config is applied to at runtime. */
export interface ApplyTargets {
	setLanguage(language: string): void;
	setGlossary(terms: string[]): void;
	setExpansions(expansions: Expansion[]): void;
}

/** Applies the wired config values to the running provider/cleanup. */
export function applyConfig(config: ResolvedConfig, targets: ApplyTargets): void {
	targets.setLanguage(config.transcriptionLanguage);
	targets.setGlossary(config.glossary);
	targets.setExpansions(config.expansions);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/macos && npm run test:unit -- --grep applyConfig` → 1 passing.

- [ ] **Step 5: Rework `wiring.ts` for live reload**

In `apps/macos/src/wiring.ts`:

Add the import (extend the existing `verbaConfig` import): change `import { loadConfig } from './config/verbaConfig';` to

```ts
import { loadConfig, applyConfig } from './config/verbaConfig';
```

Replace the body of `createDictationController` so it holds a mutable config, exposes `reloadConfig`, and returns both:

```ts
export async function createDictationController(): Promise<{
	controller: DictationController;
	reloadConfig: () => Promise<void>;
}> {
	const configState = { current: await loadConfig() };

	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
	const notifier = new TauriNotifier();
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	const provider = new DeepgramTauriProvider(secrets, deepgramPrompt, invoke, configState.current.transcriptionLanguage);

	const cleanup = new TauriCleanupService(secrets, notifier, { dangerouslyAllowBrowser: true });
	cleanup.setGlossary(configState.current.glossary);
	cleanup.setExpansions(configState.current.expansions);

	const visualization = createVisualization(invoke);
	visualization.setState('idle');

	async function reloadConfig(): Promise<void> {
		try {
			configState.current = await loadConfig();
			applyConfig(configState.current, {
				setLanguage: (l) => provider.setLanguage(l),
				setGlossary: (g) => cleanup.setGlossary(g),
				setExpansions: (e) => cleanup.setExpansions(e),
			});
		} catch (err) {
			console.warn('[Verba] reloadConfig failed:', err);
		}
	}

	const controller = new DictationController({
		deepgram: { transcribe: (audioPath) => provider.transcribe(audioPath, configState.current.glossary) },
		cleanup: {
			process: (transcript, context) =>
				cleanup.process(
					transcript,
					configState.current.language !== 'auto'
						? { ...context, detectedLanguage: configState.current.language }
						: context,
				),
		},
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding, setState: visualization.setState },
	});

	return { controller, reloadConfig };
}
```

- [ ] **Step 6: Update `main.ts` to destructure and listen**

In `apps/macos/src/main.ts`:

Add the import:

```ts
import { listen } from '@tauri-apps/api/event';
```

Change `const controller = await createDictationController();` to:

```ts
	const { controller, reloadConfig } = await createDictationController();
	void listen('config:changed', () => { void reloadConfig(); });
```

- [ ] **Step 7: Typecheck + full suite**

Run: `cd apps/macos && npm run typecheck` → clean.
Run: `cd apps/macos && npm run test:unit 2>&1 | tail -20` → all suites pass (applyConfig, DeepgramTauriProvider incl. setLanguage, plus existing).

- [ ] **Step 8: Commit**

```bash
git add apps/macos/src/config/verbaConfig.ts apps/macos/src/test/unit/applyConfig.test.ts apps/macos/src/wiring.ts apps/macos/src/main.ts
git commit -m "✨ feat(macos): Live-Reload — config:changed → reloadConfig wendet Settings sofort an"
```

---

## Manual verification (after all tasks — done with the user)

1. `just macos-dev` → tray menu shows the three submenus; the current config values are checked.
2. Pick a different transcription language → checkmark moves, `~/.config/verba/config.json` updates, and the **next** dictation transcribes in that language (no restart).
3. Change the cleanup language → the next dictation's Claude cleanup respects it.
4. "Konfiguration öffnen" opens the file (creating it if absent). Hand-edit `glossary`, then "Konfiguration neu laden" → the next dictation preserves the edited term.
5. The `Local` provider item is visibly disabled.
