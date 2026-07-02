import type { KeyValueStore } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';

/**
 * macOS implementation of the core {@link KeyValueStore} seam.
 *
 * The core interface exposes a **synchronous** `get()` (modelled on VS Code's
 * `Memento`), while Tauri IPC is async. We bridge this by loading the whole
 * store into memory once via {@link init}, serving `get()` from the cache, and
 * writing through to disk on `update()`. Persistence is a JSON file in the
 * app's config dir, handled by Rust (`kv_load` / `kv_set`); wired in M2.
 */
export class TauriKeyValueStore implements KeyValueStore {
	private cache: Record<string, unknown> = {};

	/** Loads the persisted store into memory. Call once during app startup. */
	async init(): Promise<void> {
		try {
			this.cache = (await invoke<Record<string, unknown>>('kv_load')) ?? {};
		} catch (err) {
			console.warn('[Verba] Failed to load key-value store; starting empty:', err);
			this.cache = {};
		}
	}

	get<T>(key: string, defaultValue: T): T {
		return key in this.cache ? (this.cache[key] as T) : defaultValue;
	}

	update(key: string, value: unknown): Thenable<void> {
		this.cache[key] = value;
		return invoke<void>('kv_set', { key, value });
	}
}
