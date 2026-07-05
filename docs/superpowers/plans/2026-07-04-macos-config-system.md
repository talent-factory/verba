# macOS Config System (Sub-Project A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load `~/.config/verba/config.json` at startup and wire the settings that apply to the macOS app today — fixing the Deepgram language bug and adding glossary/expansions/language-hint configurability.

**Architecture:** A Rust `read_config` command reads the JSON file; a frontend `loadConfig` parses it with defensive defaults; `wiring.ts` (now async) feeds the resolved config into the Deepgram provider (language + glossary keyterms) and the cleanup service (glossary, expansions, language hint). `@verba/core` is untouched.

**Tech Stack:** TypeScript (Vite/Tauri), Rust (Tauri commands), mocha (TDD ui) + sinon.

## Global Constraints

- Scope is `apps/macos` only. Do NOT modify `packages/core` or the VS Code extension.
- Config file: `~/.config/verba/config.json`, honoring `$XDG_CONFIG_HOME` (else `$HOME/.config`).
- Missing/unreadable/malformed config → all defaults, never a hard error.
- Defaults: `transcription.language="multi"`, `language="auto"`, `glossary=[]`, `expansions=[]`.
- `transcription.language`: `"multi"` → Deepgram `language=multi`; any other value → `language=<value>`. **`detect_language` is never sent** (removing it is the bug fix).
- No config writing, no file watching in this sub-project (that's Sub-Project B).
- Tests: mocha TDD ui (`suite`/`test`/`setup`), sinon, `assert`; files in `apps/macos/src/test/unit/*.test.ts`; run `cd apps/macos && npm run test:unit`. Rust: `cd apps/macos/src-tauri && cargo test <name>`.

---

## File Structure

- Create `apps/macos/src/config/verbaConfig.ts` — config types + `loadConfig` (Task 1).
- Create `apps/macos/src/test/unit/verbaConfig.test.ts` — loader tests (Task 1).
- Create `apps/macos/src-tauri/src/config.rs` — `read_config` command (Task 2).
- Modify `apps/macos/src-tauri/src/lib.rs` — register module + command (Task 2).
- Modify `apps/macos/src-tauri/src/transcribe.rs` — `language` param, drop `detect_language`, extract testable `build_query_params` (Task 3).
- Modify `apps/macos/src/deepgramTauriProvider.ts` — constructor `language` param, pass in invoke (Task 3).
- Modify `apps/macos/src/test/unit/deepgramTauriProvider.test.ts` — language assertions (Task 3).
- Modify `apps/macos/src/wiring.ts` — async, wire config (Task 4).
- Modify `apps/macos/src/main.ts` — `await createDictationController()` (Task 4).

---

### Task 1: Config types + `loadConfig` (TypeScript, TDD)

**Files:**
- Create: `apps/macos/src/config/verbaConfig.ts`
- Test: `apps/macos/src/test/unit/verbaConfig.test.ts`

**Interfaces:**
- Consumes: `Expansion` from `@verba/core` (`{ abbreviation: string; expansion: string }`); `invoke` from `@tauri-apps/api/core`.
- Produces: `interface VerbaConfig` (raw), `interface ResolvedConfig { transcriptionLanguage: string; language: string; glossary: string[]; expansions: Expansion[] }`, `type ReadConfig = () => Promise<string>`, and `async function loadConfig(readConfig?: ReadConfig): Promise<ResolvedConfig>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/macos/src/test/unit/verbaConfig.test.ts`:

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';

import { loadConfig } from '../../config/verbaConfig';

suite('loadConfig', () => {
	test('returns all defaults when the file is missing (empty object)', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		assert.strictEqual(cfg.transcriptionLanguage, 'multi');
		assert.strictEqual(cfg.language, 'auto');
		assert.deepStrictEqual(cfg.glossary, []);
		assert.deepStrictEqual(cfg.expansions, []);
	});

	test('returns all defaults (no throw) on malformed JSON', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{ not valid json'));
		assert.strictEqual(cfg.transcriptionLanguage, 'multi');
		assert.strictEqual(cfg.language, 'auto');
		assert.deepStrictEqual(cfg.glossary, []);
		assert.deepStrictEqual(cfg.expansions, []);
	});

	test('parses populated values through', async () => {
		const raw = JSON.stringify({
			transcription: { language: 'de' },
			language: 'de',
			glossary: ['Verba', 'Deepgram'],
			expansions: [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }],
		});
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.transcriptionLanguage, 'de');
		assert.strictEqual(cfg.language, 'de');
		assert.deepStrictEqual(cfg.glossary, ['Verba', 'Deepgram']);
		assert.deepStrictEqual(cfg.expansions, [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }]);
	});

	test('coerces wrong-typed fields to defaults', async () => {
		const raw = JSON.stringify({ glossary: 'nope', expansions: 5, transcription: { language: 42 } });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.deepStrictEqual(cfg.glossary, []);
		assert.deepStrictEqual(cfg.expansions, []);
		assert.strictEqual(cfg.transcriptionLanguage, 'multi');
	});

	test('applies defaults for fields absent from a partial config', async () => {
		const cfg = await loadConfig(sinon.stub().resolves(JSON.stringify({ transcription: { language: 'en' } })));
		assert.strictEqual(cfg.transcriptionLanguage, 'en');
		assert.strictEqual(cfg.language, 'auto');
		assert.deepStrictEqual(cfg.glossary, []);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/macos && npm run test:unit -- --grep loadConfig`
Expected: FAIL — cannot find module `../../config/verbaConfig`.

- [ ] **Step 3: Write the implementation**

Create `apps/macos/src/config/verbaConfig.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { Expansion } from '@verba/core';

/** Raw parsed shape of `~/.config/verba/config.json` — every field optional. */
export interface VerbaConfig {
	transcription?: { language?: string; provider?: string; localModel?: string };
	language?: string;
	glossary?: string[];
	expansions?: Expansion[];
	templates?: unknown[];
	autoSelectTemplate?: boolean;
	audioDevice?: string;
}

/** Config with every wired field resolved to a concrete, typed value. */
export interface ResolvedConfig {
	transcriptionLanguage: string;
	language: string;
	glossary: string[];
	expansions: Expansion[];
}

/** Reads the raw config file contents; defaults to the Tauri `read_config` command. */
export type ReadConfig = () => Promise<string>;

const DEFAULTS: ResolvedConfig = {
	transcriptionLanguage: 'multi',
	language: 'auto',
	glossary: [],
	expansions: [],
};

const invokeReadConfig: ReadConfig = () => invoke<string>('read_config');

function nonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isExpansionArray(v: unknown): v is Expansion[] {
	return Array.isArray(v) && v.every(
		(x) => !!x && typeof x === 'object'
			&& typeof (x as Expansion).abbreviation === 'string'
			&& typeof (x as Expansion).expansion === 'string',
	);
}

/**
 * Reads and resolves the user config. Never throws: a missing, unreadable, or
 * malformed file — or any wrong-typed field — falls back to {@link DEFAULTS}.
 */
export async function loadConfig(readConfig: ReadConfig = invokeReadConfig): Promise<ResolvedConfig> {
	let raw: VerbaConfig = {};
	try {
		const parsed: unknown = JSON.parse(await readConfig());
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			raw = parsed as VerbaConfig;
		}
	} catch (err) {
		console.warn('[Verba] Could not read/parse config; using defaults:', err);
	}

	return {
		transcriptionLanguage: nonEmptyString(raw.transcription?.language)
			? raw.transcription!.language!
			: DEFAULTS.transcriptionLanguage,
		language: nonEmptyString(raw.language) ? raw.language : DEFAULTS.language,
		glossary: isStringArray(raw.glossary) ? raw.glossary : DEFAULTS.glossary,
		expansions: isExpansionArray(raw.expansions) ? raw.expansions : DEFAULTS.expansions,
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/macos && npm run test:unit -- --grep loadConfig`
Expected: PASS — 5 passing.

- [ ] **Step 5: Typecheck**

Run: `cd apps/macos && npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/macos/src/config/verbaConfig.ts apps/macos/src/test/unit/verbaConfig.test.ts
git commit -m "✨ feat(macos): Config-Loader für ~/.config/verba/config.json"
```

---

### Task 2: Rust `read_config` command

**Files:**
- Create: `apps/macos/src-tauri/src/config.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs` (add `mod config;` with the other modules; add `config::read_config` to `generate_handler!`)

**Interfaces:**
- Produces: `#[tauri::command] pub fn read_config() -> String` — raw file contents, or `"{}"` if absent/unreadable. Consumed by `loadConfig`'s default `readConfig` via `invoke('read_config')`.

- [ ] **Step 1: Write the command with a test**

Create `apps/macos/src-tauri/src/config.rs`:

```rust
//! Reads the user's JSON config file (`~/.config/verba/config.json`, honoring
//! `$XDG_CONFIG_HOME`) for the frontend. Parsing and validation happen on the
//! frontend, so this stays a dumb reader that never fails.

use std::path::PathBuf;

/// `$XDG_CONFIG_HOME/verba/config.json` if that var is set and non-empty, else
/// `$HOME/.config/verba/config.json`. `None` if `HOME` is also unavailable.
fn config_path() -> Option<PathBuf> {
    let base = match std::env::var("XDG_CONFIG_HOME") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => PathBuf::from(std::env::var("HOME").ok()?).join(".config"),
    };
    Some(base.join("verba").join("config.json"))
}

/// Returns the raw contents of the config file, or `"{}"` if it is absent or
/// unreadable. Never fails — the frontend parses and applies defaults.
#[tauri::command]
pub fn read_config() -> String {
    config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_config_never_panics_and_returns_nonempty() {
        // Regardless of whether a config file exists on the test machine, the
        // command must return a non-empty string and never panic. Parsing and
        // default-handling are covered by the frontend `loadConfig` tests.
        assert!(!read_config().is_empty());
    }

    #[test]
    fn config_path_ends_with_verba_config_json() {
        if let Some(p) = config_path() {
            assert!(p.ends_with("verba/config.json"));
        }
    }
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add `mod config;` alongside the other module declarations (keep alphabetical: after `mod audio;`, before `mod env;` if present — place it so the list stays sorted):

```rust
mod audio;
mod config;
mod env;
mod paste;
mod secret;
mod store;
mod transcribe;
```

Add `config::read_config,` to the `tauri::generate_handler!` list (next to the other commands):

```rust
            config::read_config,
```

- [ ] **Step 3: Run the Rust test + build**

Run: `cd apps/macos/src-tauri && cargo test config:: 2>&1 | tail -15`
Expected: both `config::tests::*` tests pass.

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -8`
Expected: `Finished`, no warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/macos/src-tauri/src/config.rs apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): Rust-Command read_config (~/.config/verba/config.json)"
```

---

### Task 3: Deepgram language plumbing

**Files:**
- Modify: `apps/macos/src-tauri/src/transcribe.rs`
- Modify: `apps/macos/src/deepgramTauriProvider.ts`
- Test: `apps/macos/src/test/unit/deepgramTauriProvider.test.ts` (extend)

**Interfaces:**
- Consumes: `transcription.language` (a `string`, from `ResolvedConfig`).
- Produces: `DeepgramTauriProvider` constructor now `(secretStorage, promptForApiKey, invoke?, language?: string = 'multi')`; the `deepgram_transcribe` invoke payload gains `language`. Rust `deepgram_transcribe(api_key, audio_path, keyterms, language: String)`.

- [ ] **Step 1: Write/adjust the failing tests**

In `apps/macos/src/test/unit/deepgramTauriProvider.test.ts`, the existing `setup` constructs `new DeepgramTauriProvider(secretStorage, promptForApiKey, invoke)` (3 args). Add these two tests inside the `suite('DeepgramTauriProvider', …)` block:

```ts
	test('passes the default language "multi" in the transcribe request', async () => {
		invoke.resolves({ text: 'hi' });
		await provider.transcribe('/tmp/rec.wav');
		assert.strictEqual(invoke.firstCall.args[1].language, 'multi');
	});

	test('passes a configured language in the transcribe request', async () => {
		invoke.resolves({ text: 'hi' });
		const deProvider = new DeepgramTauriProvider(secretStorage, promptForApiKey, invoke, 'de');
		await deProvider.transcribe('/tmp/rec.wav');
		assert.strictEqual(invoke.firstCall.args[1].language, 'de');
	});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/macos && npm run test:unit -- --grep DeepgramTauriProvider`
Expected: FAIL — `invoke.firstCall.args[1].language` is `undefined`.

- [ ] **Step 3: Add the `language` param to the provider**

In `apps/macos/src/deepgramTauriProvider.ts`:

Add a private field and constructor param. Change the class field block and constructor to:

```ts
	private readonly secretStorage: SecretStore;
	private readonly promptForApiKey: ApiKeyPrompt;
	private readonly invoke: Invoke;
	private readonly language: string;

	/**
	 * @param invoke Defaults to the real Tauri `invoke`. Injectable for tests.
	 * @param language Deepgram `language` value ("multi" or a specific code like
	 *   "de"). Defaults to "multi".
	 */
	constructor(
		secretStorage: SecretStore,
		promptForApiKey: ApiKeyPrompt,
		invoke: Invoke = tauriInvoke,
		language: string = 'multi',
	) {
		this.secretStorage = secretStorage;
		this.promptForApiKey = promptForApiKey;
		this.invoke = invoke;
		this.language = language;
	}
```

In `transcribe()`, add `language` to the invoke payload:

```ts
			result = await this.invoke<TranscriptionResult>('deepgram_transcribe', {
				apiKey,
				audioPath: source,
				keyterms,
				language: this.language,
			});
```

- [ ] **Step 4: Add the `language` param to Rust `deepgram_transcribe` and drop `detect_language`**

In `apps/macos/src-tauri/src/transcribe.rs`, change the command signature to accept `language` and replace the inline `params` vec with a call to a new testable helper. Update the signature:

```rust
pub async fn deepgram_transcribe(
    api_key: String,
    audio_path: String,
    keyterms: Vec<String>,
    language: String,
) -> Result<TranscriptionResult, String> {
```

Replace the existing `let mut params: Vec<(&str, String)> = vec![ … ];` block (the one with `model`, `language=multi`, `smart_format`, `detect_language`, and the keyterm loop) with:

```rust
    let params = build_query_params(language, &keyterms);
```

Add this helper function (near the command, module scope):

```rust
/// Builds the Deepgram `/listen` query params. `language` is passed through
/// verbatim ("multi" for multilingual code-switching, or a specific code like
/// "de"). `detect_language` is intentionally NOT set — combining it with an
/// explicit `language` produced wrong-language transcripts.
fn build_query_params(language: String, keyterms: &[String]) -> Vec<(&'static str, String)> {
    let mut params: Vec<(&'static str, String)> = vec![
        ("model", "nova-3".to_string()),
        ("language", language),
        ("smart_format", "true".to_string()),
    ];
    for kt in keyterms {
        params.push(("keyterm", kt.clone()));
    }
    params
}
```

Add Rust tests in `transcribe.rs`'s `#[cfg(test)] mod tests` (create the block if none exists; if one exists, add these):

```rust
    #[test]
    fn build_query_params_sets_language_and_omits_detect_language() {
        let p = build_query_params("de".to_string(), &[]);
        assert!(p.contains(&("language", "de".to_string())));
        assert!(p.contains(&("model", "nova-3".to_string())));
        assert!(p.iter().all(|(k, _)| *k != "detect_language"));
    }

    #[test]
    fn build_query_params_appends_keyterms() {
        let p = build_query_params("multi".to_string(), &["Verba:2".to_string()]);
        assert!(p.contains(&("keyterm", "Verba:2".to_string())));
    }
```

If `transcribe.rs` has no `use super::*;` test module yet, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    // (tests above)
}
```

- [ ] **Step 5: Run TS + Rust tests + build**

Run: `cd apps/macos && npm run test:unit -- --grep DeepgramTauriProvider`
Expected: PASS (existing tests + the 2 new language tests).

Run: `cd apps/macos/src-tauri && cargo test transcribe:: 2>&1 | tail -15`
Expected: `build_query_params_*` tests pass.

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -8`
Expected: `Finished`, no warnings.

- [ ] **Step 6: Typecheck + commit**

Run: `cd apps/macos && npm run typecheck` (expect clean).

```bash
git add apps/macos/src/deepgramTauriProvider.ts apps/macos/src/test/unit/deepgramTauriProvider.test.ts apps/macos/src-tauri/src/transcribe.rs
git commit -m "✨ feat(macos): Transkriptionssprache konfigurierbar, widersprüchliches detect_language entfernt"
```

---

### Task 4: Wire config into the app

**Files:**
- Modify: `apps/macos/src/wiring.ts`
- Modify: `apps/macos/src/main.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), the `language`-aware `DeepgramTauriProvider` (Task 3).
- Produces: `createDictationController` is now `async` (`Promise<DictationController>`). No other public surface changes.

- [ ] **Step 1: Make `wiring.ts` async and wire the config**

In `apps/macos/src/wiring.ts`, add the import next to the other local imports:

```ts
import { loadConfig } from './config/verbaConfig';
```

Change `createDictationController` to async and wire the config. Replace the current function body so it reads:

```ts
export async function createDictationController(): Promise<DictationController> {
	const config = await loadConfig();

	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
	const notifier = new TauriNotifier();
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	const provider = new DeepgramTauriProvider(secrets, deepgramPrompt, invoke, config.transcriptionLanguage);

	const cleanup = new TauriCleanupService(secrets, notifier, { dangerouslyAllowBrowser: true });
	cleanup.setGlossary(config.glossary);
	cleanup.setExpansions(config.expansions);

	return new DictationController({
		// Inject the configured glossary as Deepgram keyterms on every transcription.
		deepgram: { transcribe: (audioPath) => provider.transcribe(audioPath, config.glossary) },
		// Override the cleanup language hint when the user pinned a language (≠ "auto").
		cleanup: {
			process: (transcript, context) =>
				cleanup.process(
					transcript,
					config.language !== 'auto' ? { ...context, detectedLanguage: config.language } : context,
				),
		},
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding },
	});
}
```

(The `deepgram` and `cleanup` arrow parameters are contextually typed by `ControllerDeps`, so no extra type imports are needed. Keep all existing imports; `EnvAwareSecretStore`, `DeepgramTauriProvider`, `TauriCleanupService`, `TauriNotifier`, `TauriKeyValueStore`, `TauriSecretStore`, `invoke`, `promptForApiKey`, `setPhase`, `showTranscript`, `showAccessibilityOnboarding`, `ApiKeyPrompt` are already imported.)

- [ ] **Step 2: Await the factory in `main.ts`**

In `apps/macos/src/main.ts`, change:

```ts
	const controller = createDictationController();
```

to:

```ts
	const controller = await createDictationController();
```

(`main()` is already `async` and already `await`s `controller.init()`.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/macos && npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 4: Run the full macOS unit suite (no regressions)**

Run: `cd apps/macos && npm run test:unit 2>&1 | tail -20`
Expected: all suites pass (loadConfig, EnvAwareSecretStore, DeepgramTauriProvider incl. language, controller).

- [ ] **Step 5: Commit**

```bash
git add apps/macos/src/wiring.ts apps/macos/src/main.ts
git commit -m "✨ feat(macos): Config verdrahtet — Sprache, Glossar, Expansions, Cleanup-Hint"
```

---

## Manual verification (after all tasks — done with the user)

1. No config file → `just macos-dev`, dictate German → works (default `multi`), no crash.
2. `mkdir -p ~/.config/verba && echo '{"transcription":{"language":"de"}}' > ~/.config/verba/config.json`, restart, dictate the earlier failing German phrase ("Voila, es scheint zu funktionieren") → correct German transcript, no Dutch drift.
3. Add `"glossary":["Verba"]` and an expansion, restart, dictate → term preserved / abbreviation expanded.
