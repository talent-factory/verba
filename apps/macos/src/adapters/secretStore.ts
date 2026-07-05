import type { SecretStore } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';

/**
 * macOS implementation of the core {@link SecretStore} seam, backed by the
 * system Keychain via Rust commands (`secret_get` / `secret_set` /
 * `secret_delete`). The Rust side (src-tauri) implements these using
 * `security-framework`; this is wired in milestone M2.
 */
export class TauriSecretStore implements SecretStore {
	get(key: string): Thenable<string | undefined> {
		return invoke<string | null>('secret_get', { key }).then(v => v ?? undefined);
	}

	store(key: string, value: string): Thenable<void> {
		return invoke<void>('secret_set', { key, value });
	}

	delete(key: string): Thenable<void> {
		return invoke<void>('secret_delete', { key });
	}
}
