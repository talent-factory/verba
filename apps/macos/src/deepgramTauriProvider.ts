import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { SecretStore, TranscriptionBackend, TranscriptionResult, ApiKeyPrompt } from '@verba/core';
import { validateTranscript, API_KEY_STORAGE_KEY, truncateKeyterms, resolveApiKey, INVALID_DEEPGRAM_API_KEY_MESSAGE } from '@verba/core';

// Keep in sync with `DEEPGRAM_UNAUTHORIZED` in
// `../src-tauri/src/transcribe.rs` — there is no shared type across the
// Rust/TypeScript IPC boundary to enforce this, so a drift here silently
// breaks the invalid-key recovery path below (the key is never cleared).
const UNAUTHORIZED_SENTINEL = 'deepgram_unauthorized';

/**
 * Shown when the invalid Deepgram key is pinned by the environment. Deleting the
 * Keychain entry can't recover here — `EnvAwareSecretStore.get()` reads the env
 * var first, so the next attempt would resolve the same bad key and skip the
 * re-prompt. The user must fix the variable, so say so explicitly.
 */
export const ENV_PINNED_DEEPGRAM_API_KEY_MESSAGE =
	'The Deepgram API key from the environment (VERBA_DEEPGRAM_API_KEY / DEEPGRAM_API_KEY) is invalid. Unset or correct that variable and restart Verba.';

/** Matches the shape of `@tauri-apps/api/core`'s `invoke`, narrowed to what this class needs. */
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Deepgram transcription for the macOS app, calling a native Rust command
 * (`deepgram_transcribe`) instead of `@deepgram/sdk`.
 *
 * `@verba/core`'s `DeepgramProvider` cannot run here: `@deepgram/sdk`'s
 * `AbstractRestClient` constructor throws unconditionally in any browser-like
 * environment (Tauri's WebView included) unless a `proxy` option is
 * configured — before a custom `fetch` implementation ever gets a chance to
 * run. The actual HTTP call happens in Rust (`src-tauri/src/transcribe.rs`),
 * which has no such restriction (CORS is a browser concept, not a native-HTTP
 * one). This class implements the same `TranscriptionBackend` contract as the
 * SDK-based provider, so the rest of `@verba/core` (glossary handling via
 * `CleanupService`, the pipeline) is unaffected. Key-storage and
 * keyterm-truncation logic are shared with `DeepgramProvider` via
 * `@verba/core` rather than duplicated here.
 */
export class DeepgramTauriProvider implements TranscriptionBackend {
	readonly name = 'Deepgram Transcription (native)';
	private readonly secretStorage: SecretStore;
	private readonly promptForApiKey: ApiKeyPrompt;
	private readonly invoke: Invoke;
	private language: string;

	/**
	 * @param invoke Defaults to the real Tauri `invoke`. Injectable so tests
	 *   can exercise this class's logic (unauthorized-key recovery, error
	 *   formatting) without a Tauri runtime.
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

	/** Updates the Deepgram language used by subsequent transcriptions. */
	setLanguage(language: string): void {
		this.language = language;
	}

	async transcribe(source: string, glossary?: string[]): Promise<TranscriptionResult> {
		const apiKey = await resolveApiKey(this.secretStorage, this.promptForApiKey, API_KEY_STORAGE_KEY);
		const keyterms = glossary?.length ? truncateKeyterms(glossary) : [];

		let result: TranscriptionResult;
		try {
			result = await this.invoke<TranscriptionResult>('deepgram_transcribe', {
				apiKey,
				audioPath: source,
				keyterms,
				language: this.language,
			});
		} catch (err: unknown) {
			if (err === UNAUTHORIZED_SENTINEL || (err instanceof Error && err.message === UNAUTHORIZED_SENTINEL)) {
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(await this.invalidKeyMessage());
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(detail.startsWith('Transcription failed:') ? detail : `Transcription failed: ${detail}`);
		}

		return { text: validateTranscript(result.text), detectedLanguage: result.detectedLanguage };
	}

	/**
	 * Chooses the invalid-key message after the Keychain entry has been cleared.
	 * If a key STILL resolves, it comes from the environment (the Keychain was
	 * just emptied), so the generic "will re-prompt" message would be misleading
	 * — the user is stuck until they fix the env var.
	 */
	private async invalidKeyMessage(): Promise<string> {
		try {
			if (await this.secretStorage.get(API_KEY_STORAGE_KEY)) {
				return ENV_PINNED_DEEPGRAM_API_KEY_MESSAGE;
			}
		} catch {
			// Fall through to the generic message if the store can't be probed.
		}
		return INVALID_DEEPGRAM_API_KEY_MESSAGE;
	}
}
