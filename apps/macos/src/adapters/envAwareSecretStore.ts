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
