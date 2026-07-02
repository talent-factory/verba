import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { SecretStore, TranscriptionBackend, TranscriptionResult, ApiKeyPrompt } from '@verba/core';
import { validateTranscript, API_KEY_STORAGE_KEY, truncateKeyterms, resolveApiKey, INVALID_DEEPGRAM_API_KEY_MESSAGE } from '@verba/core';

// Keep in sync with `DEEPGRAM_UNAUTHORIZED` in
// `../src-tauri/src/transcribe.rs` — there is no shared type across the
// Rust/TypeScript IPC boundary to enforce this, so a drift here silently
// breaks the invalid-key recovery path below (the key is never cleared).
const UNAUTHORIZED_SENTINEL = 'deepgram_unauthorized';

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

	/**
	 * @param invoke Defaults to the real Tauri `invoke`. Injectable so tests
	 *   can exercise this class's logic (unauthorized-key recovery, error
	 *   formatting) without a Tauri runtime.
	 */
	constructor(secretStorage: SecretStore, promptForApiKey: ApiKeyPrompt, invoke: Invoke = tauriInvoke) {
		this.secretStorage = secretStorage;
		this.promptForApiKey = promptForApiKey;
		this.invoke = invoke;
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
			});
		} catch (err: unknown) {
			if (err === UNAUTHORIZED_SENTINEL || (err instanceof Error && err.message === UNAUTHORIZED_SENTINEL)) {
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(INVALID_DEEPGRAM_API_KEY_MESSAGE);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(detail.startsWith('Transcription failed:') ? detail : `Transcription failed: ${detail}`);
		}

		return { text: validateTranscript(result.text), detectedLanguage: result.detectedLanguage };
	}
}
