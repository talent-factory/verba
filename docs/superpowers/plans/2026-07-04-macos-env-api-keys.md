# macOS ENV API Keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the macOS app's Deepgram and Anthropic API keys from environment variables (env → Keychain → GUI prompt), so a shell-launched dev build needs no key prompt.

**Architecture:** An `EnvAwareSecretStore` decorator wraps `TauriSecretStore` at the `@verba/core` `SecretStore` seam. Its `get()` first tries env vars (via a new Rust `env_var` command), then delegates to the Keychain. `@verba/core` is untouched.

**Tech Stack:** TypeScript (Vite/Tauri frontend), Rust (Tauri commands), mocha (TDD ui) + sinon for unit tests.

## Global Constraints

- Scope is `apps/macos` only. Do NOT modify `packages/core` or the VS Code extension.
- Env-name lookup order per key (first non-blank wins):
  - `anthropic-api-key` → `VERBA_ANTHROPIC_API_KEY`, then `ANTHROPIC_API_KEY`
  - `verba.deepgramApiKey` → `VERBA_DEEPGRAM_API_KEY`, then `DEEPGRAM_API_KEY`
- Precedence: env first, then Keychain, then GUI prompt.
- Env-provided keys are never persisted (only the prompt path calls `store`).
- Env-read failures must never break key resolution — swallow and fall through to Keychain.
- Tests: mocha TDD ui (`suite`/`test`/`setup`), sinon stubs, `assert`. Files in `apps/macos/src/test/unit/*.test.ts`. Run with `cd apps/macos && npm run test:unit`.

---

## File Structure

- Create `apps/macos/src/adapters/envAwareSecretStore.ts` — the decorator (Task 1).
- Create `apps/macos/src/test/unit/envAwareSecretStore.test.ts` — unit tests (Task 1).
- Create `apps/macos/src-tauri/src/env.rs` — the `env_var` command (Task 2).
- Modify `apps/macos/src-tauri/src/lib.rs` — register the module + command (Task 2).
- Modify `apps/macos/src/wiring.ts` — wrap `TauriSecretStore` (Task 3).

---

### Task 1: `EnvAwareSecretStore` decorator (TypeScript, TDD)

**Files:**
- Create: `apps/macos/src/adapters/envAwareSecretStore.ts`
- Test: `apps/macos/src/test/unit/envAwareSecretStore.test.ts`

**Interfaces:**
- Consumes: `SecretStore` from `@verba/core` (methods `get(key): Thenable<string|undefined>`, `store(key,value): Thenable<void>`, `delete(key): Thenable<void>`).
- Produces: `export class EnvAwareSecretStore implements SecretStore`, constructed as `new EnvAwareSecretStore(inner: SecretStore, readEnv?: ReadEnv)` where `export type ReadEnv = (name: string) => Promise<string | undefined>`. Default `readEnv` calls the Tauri `env_var` command (Task 2).

- [ ] **Step 1: Write the failing tests**

Create `apps/macos/src/test/unit/envAwareSecretStore.test.ts`:

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';

import { EnvAwareSecretStore } from '../../adapters/envAwareSecretStore';

function createFakeInner(): {
	get: sinon.SinonStub;
	store: sinon.SinonStub;
	delete: sinon.SinonStub;
} {
	return {
		get: sinon.stub().resolves(undefined),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
	};
}

suite('EnvAwareSecretStore', () => {
	let inner: ReturnType<typeof createFakeInner>;

	setup(() => {
		inner = createFakeInner();
	});

	test('returns the env value without consulting the keychain (env precedence)', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_ANTHROPIC_API_KEY').resolves(undefined);
		readEnv.withArgs('ANTHROPIC_API_KEY').resolves('env-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'env-key');
		assert.strictEqual(inner.get.called, false);
	});

	test('prefers the VERBA_-prefixed name over the SDK-standard name', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_DEEPGRAM_API_KEY').resolves('verba-pref');
		readEnv.withArgs('DEEPGRAM_API_KEY').resolves('sdk-std');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('verba.deepgramApiKey');

		assert.strictEqual(result, 'verba-pref');
		assert.strictEqual(readEnv.calledWith('DEEPGRAM_API_KEY'), false);
	});

	test('falls back to the keychain when no env var is set', async () => {
		const readEnv = sinon.stub().resolves(undefined);
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'keychain-key');
	});

	test('delegates straight to the keychain for an unmapped storage key', async () => {
		const readEnv = sinon.stub().resolves('should-not-be-used');
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('some.other.key');

		assert.strictEqual(result, 'keychain-key');
		assert.strictEqual(readEnv.called, false);
	});

	test('falls through to the keychain when readEnv throws', async () => {
		const readEnv = sinon.stub().rejects(new Error('ipc failed'));
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'keychain-key');
	});

	test('treats a blank env value as unset', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_ANTHROPIC_API_KEY').resolves('   ');
		readEnv.withArgs('ANTHROPIC_API_KEY').resolves(undefined);
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'keychain-key');
	});

	test('store and delete delegate verbatim to the wrapped store', async () => {
		const store = new EnvAwareSecretStore(inner, sinon.stub().resolves(undefined));

		await store.store('k', 'v');
		await store.delete('k');

		assert.strictEqual(inner.store.calledOnceWith('k', 'v'), true);
		assert.strictEqual(inner.delete.calledOnceWith('k'), true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/macos && npm run test:unit -- --grep EnvAwareSecretStore`
Expected: FAIL — `Cannot find module '../../adapters/envAwareSecretStore'` (compile error) or the suite errors because the class does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/macos/src/adapters/envAwareSecretStore.ts`:

```ts
import type { SecretStore } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';

/** Reads a single environment variable; resolves `undefined` when unset/blank. */
export type ReadEnv = (name: string) => Promise<string | undefined>;

/**
 * Maps a core storage key to the environment-variable names to try, in order
 * (the `VERBA_`-prefixed name first, then the SDK-standard name).
 *
 * The keys here mirror the storage-key constants in `@verba/core`:
 *   - `anthropic-api-key`    — `cleanupService.ts` (not exported)
 *   - `verba.deepgramApiKey` — `deepgramProvider.ts` (`API_KEY_STORAGE_KEY`)
 * There is no shared constant across the package boundary, so a drift here
 * silently disables the env lookup for that key. Keep in sync.
 */
const ENV_NAMES: Record<string, string[]> = {
	'anthropic-api-key': ['VERBA_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
	'verba.deepgramApiKey': ['VERBA_DEEPGRAM_API_KEY', 'DEEPGRAM_API_KEY'],
};

/** Default env reader: the Rust `env_var` command (see src-tauri/src/env.rs). */
const invokeEnvVar: ReadEnv = (name) =>
	invoke<string | null>('env_var', { name }).then((v) => v ?? undefined);

/**
 * Wraps a {@link SecretStore} so `get()` resolves API keys from the shell
 * environment before falling back to the wrapped store (Keychain). Env values
 * are never written back — only `store()`/`delete()` mutate, and those delegate
 * unchanged, so the prompt path remains the only writer.
 */
export class EnvAwareSecretStore implements SecretStore {
	constructor(
		private readonly inner: SecretStore,
		private readonly readEnv: ReadEnv = invokeEnvVar,
	) {}

	async get(key: string): Promise<string | undefined> {
		for (const name of ENV_NAMES[key] ?? []) {
			try {
				const value = await this.readEnv(name);
				if (value && value.trim().length > 0) {
					return value;
				}
			} catch (err) {
				// Env lookup must never break key resolution; fall through to Keychain.
				console.warn(`[Verba] env lookup for ${name} failed:`, err);
			}
		}
		return this.inner.get(key);
	}

	store(key: string, value: string): Thenable<void> {
		return this.inner.store(key, value);
	}

	delete(key: string): Thenable<void> {
		return this.inner.delete(key);
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/macos && npm run test:unit -- --grep EnvAwareSecretStore`
Expected: PASS — 7 passing.

- [ ] **Step 5: Typecheck**

Run: `cd apps/macos && npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/macos/src/adapters/envAwareSecretStore.ts apps/macos/src/test/unit/envAwareSecretStore.test.ts
git commit -m "✨ feat(macos): EnvAwareSecretStore — API-Keys aus ENV vor Keychain"
```

---

### Task 2: Rust `env_var` command

**Files:**
- Create: `apps/macos/src-tauri/src/env.rs`
- Modify: `apps/macos/src-tauri/src/lib.rs` (add `mod env;` near the other `mod` lines; add `env::env_var` to the `tauri::generate_handler!` list)

**Interfaces:**
- Produces: `#[tauri::command] pub fn env_var(name: String) -> Option<String>` — returns the env var value, or `None` if unset or whitespace-only. Consumed by `EnvAwareSecretStore`'s default `readEnv` (Task 1) via `invoke('env_var', { name })`.

- [ ] **Step 1: Write the command with a unit test**

Create `apps/macos/src-tauri/src/env.rs`:

```rust
//! Reads environment variables for the frontend, so API keys can be sourced
//! from the shell environment before falling back to the Keychain.
//!
//! NOTE: a process only inherits shell env vars when launched from a shell
//! (e.g. `just macos-dev`). A Finder-launched `.app` bundle does not — there,
//! the Keychain / prompt path applies.

/// Returns the value of the named environment variable, or `None` if it is
/// unset or blank (whitespace-only).
#[tauri::command]
pub fn env_var(name: String) -> Option<String> {
    std::env::var(&name).ok().filter(|v| !v.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_for_an_unset_variable() {
        assert_eq!(env_var("VERBA_DEFINITELY_UNSET_ENV_VAR_XYZ".to_string()), None);
    }
}
```

- [ ] **Step 2: Register the module and command in `lib.rs`**

In `apps/macos/src-tauri/src/lib.rs`, add `env` to the module list at the top (alongside `mod audio;`, `mod paste;`, …):

```rust
mod audio;
mod env;
mod paste;
mod secret;
mod store;
mod transcribe;
```

And add `env::env_var,` to the `tauri::generate_handler!` invocation (next to `audio::start_capture`, etc.):

```rust
        .invoke_handler(tauri::generate_handler![
            audio::start_capture,
            audio::stop_capture,
            env::env_var,
            paste::has_accessibility_permission,
            paste::open_accessibility_settings,
            paste::paste_text,
            secret::secret_get,
            secret::secret_set,
            secret::secret_delete,
            store::kv_load,
            store::kv_set,
            transcribe::deepgram_transcribe,
        ])
```

- [ ] **Step 3: Run the Rust test + build**

Run: `cd apps/macos/src-tauri && cargo test env_var 2>&1 | tail -15`
Expected: `test env::tests::returns_none_for_an_unset_variable ... ok`.

Run: `cd apps/macos/src-tauri && cargo build 2>&1 | tail -15`
Expected: `Finished` (no errors; a clippy-style unused warning is acceptable but there should be none).

- [ ] **Step 4: Commit**

```bash
git add apps/macos/src-tauri/src/env.rs apps/macos/src-tauri/src/lib.rs
git commit -m "✨ feat(macos): Rust-Command env_var zum Lesen von Umgebungsvariablen"
```

---

### Task 3: Wire `EnvAwareSecretStore` into the app

**Files:**
- Modify: `apps/macos/src/wiring.ts`

**Interfaces:**
- Consumes: `EnvAwareSecretStore` (Task 1), `env_var` command (Task 2).
- Produces: nothing new; `createDictationController()` now builds its `SecretStore` as `new EnvAwareSecretStore(new TauriSecretStore())`, feeding both the Deepgram provider and the cleanup service.

- [ ] **Step 1: Update the import and construction in `wiring.ts`**

Add the import next to the other adapter imports:

```ts
import { EnvAwareSecretStore } from './adapters/envAwareSecretStore';
```

Change the `secrets` line inside `createDictationController()` from:

```ts
	const secrets = new TauriSecretStore();
```

to:

```ts
	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
```

(Leave the rest of `createDictationController` unchanged — `secrets` is already passed to `TauriSecretStore`'s consumers.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/macos && npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Run the full macOS unit suite (no regressions)**

Run: `cd apps/macos && npm run test:unit 2>&1 | tail -20`
Expected: all suites pass, including `EnvAwareSecretStore` and the existing `DeepgramTauriProvider` / controller suites.

- [ ] **Step 4: Commit**

```bash
git add apps/macos/src/wiring.ts
git commit -m "✨ feat(macos): API-Key-Auflösung über ENV → Keychain → Prompt verdrahten"
```

---

## Manual verification (after all tasks)

Not a task — done interactively with the user:

1. `export VERBA_DEEPGRAM_API_KEY=…` and `export VERBA_ANTHROPIC_API_KEY=…` (or the SDK-standard names) in the shell, then `just macos-dev`.
2. Dictate into another app (e.g. Sublime): no key prompt should appear, and — with no window reveal stealing focus — the cleaned text should paste into the frontmost app.
3. This also settles the remaining paste question: if paste now lands correctly, the earlier failure was the prompt's focus theft; if not, investigate Accessibility trust for the dev binary. (The temporary `paste.rs` logging is still in place to observe this, and is reverted afterwards.)
