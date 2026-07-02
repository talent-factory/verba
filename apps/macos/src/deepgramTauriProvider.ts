import { invoke } from '@tauri-apps/api/core';
import type { SecretStore, TranscriptionBackend, TranscriptionResult, ApiKeyPrompt } from '@verba/core';
import { validateTranscript } from '@verba/core';

const API_KEY_STORAGE_KEY = 'verba.deepgramApiKey';
const UNAUTHORIZED_SENTINEL = 'deepgram_unauthorized';

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
 * `CleanupService`, the pipeline) is unaffected.
 */
export class DeepgramTauriProvider implements TranscriptionBackend {
	readonly name = 'Deepgram Transcription (native)';
	private readonly secretStorage: SecretStore;
	private readonly promptForApiKey: ApiKeyPrompt;

	constructor(secretStorage: SecretStore, promptForApiKey: ApiKeyPrompt) {
		this.secretStorage = secretStorage;
		this.promptForApiKey = promptForApiKey;
	}

	async transcribe(source: string, glossary?: string[]): Promise<TranscriptionResult> {
		const apiKey = await this.getApiKey();
		const keyterms = glossary?.length ? this.truncateKeyterms(glossary) : [];

		let result: TranscriptionResult;
		try {
			result = await invoke<TranscriptionResult>('deepgram_transcribe', {
				apiKey,
				audioPath: source,
				keyterms,
			});
		} catch (err: unknown) {
			if (err === UNAUTHORIZED_SENTINEL || (err instanceof Error && err.message === UNAUTHORIZED_SENTINEL)) {
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(
					'Invalid Deepgram API key. It has been removed — you will be prompted again on next use.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(detail.startsWith('Transcription failed:') ? detail : `Transcription failed: ${detail}`);
		}

		return { text: validateTranscript(result.text), detectedLanguage: result.detectedLanguage };
	}

	/**
	 * Truncates glossary terms to fit within Deepgram's keyterm token budget.
	 * Mirrors `@verba/core`'s `DeepgramProvider.truncateKeyterms` exactly, since
	 * that logic is portable (no SDK/DOM dependency) but not exported.
	 */
	private truncateKeyterms(glossary: string[]): string[] {
		const MAX_TOKENS = 200;
		const keyterms: string[] = [];
		let tokenCount = 0;

		for (const term of glossary) {
			const kt = `${term}:2`;
			const estimated = Math.max(1, Math.ceil(kt.length / 3));
			if (tokenCount + estimated > MAX_TOKENS) {
				break;
			}
			keyterms.push(kt);
			tokenCount += estimated;
		}

		if (keyterms.length < glossary.length) {
			console.log(
				`[Verba] Glossary truncated: ${keyterms.length}/${glossary.length} terms sent as keyterms (${tokenCount} estimated tokens, limit ${MAX_TOKENS})`
			);
		}

		return keyterms;
	}

	private async getApiKey(): Promise<string> {
		const stored = await this.secretStorage.get(API_KEY_STORAGE_KEY);
		if (stored) {
			return stored;
		}

		const key = await this.promptForApiKey();
		if (!key) {
			throw new Error('Deepgram API key required for transcription.');
		}

		await this.secretStorage.store(API_KEY_STORAGE_KEY, key);
		return key;
	}
}
