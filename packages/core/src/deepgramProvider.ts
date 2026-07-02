/**
 * DeepgramProvider — portable cloud transcription via the Deepgram Nova-3
 * pre-recorded API.
 *
 * Part of `@verba/core`: no `vscode`, no `fs`, no `child_process`. Audio bytes
 * arrive through an injected {@link AudioBytesReader}, and the API-key prompt is
 * an injected callback, so this runs unchanged on the VS Code extension, a Tauri
 * app, or a mobile host.
 */

import { SecretStore, AudioBytesReader } from './adapters';
import { TranscriptionBackend, TranscriptionResult, validateTranscript } from './transcription';

const API_KEY_STORAGE_KEY = 'verba.deepgramApiKey';

// Lazy-load @deepgram/sdk so the module can be imported in environments that
// resolve the SDK differently (and to mirror the pattern used elsewhere).
function getDeepgramSdk(): typeof import('@deepgram/sdk') {
	return require('@deepgram/sdk');
}

/** Prompts the host user for a Deepgram API key. Returns undefined if cancelled. */
export type ApiKeyPrompt = () => Promise<string | undefined>;

export class DeepgramProvider implements TranscriptionBackend {
	readonly name = 'Deepgram Transcription';
	private _client: any = null;
	private _language: string = 'auto';
	private readonly secretStorage: SecretStore;
	private readonly readAudioFile: AudioBytesReader;
	private readonly promptForApiKey: ApiKeyPrompt;

	/**
	 * @param secretStorage Secure store for the Deepgram API key.
	 * @param readAudioFile Reads raw audio bytes from a source. Injected so core
	 *   stays free of `fs` — the host supplies the filesystem/handle logic.
	 * @param promptForApiKey Host callback to obtain a key when none is stored.
	 */
	constructor(secretStorage: SecretStore, readAudioFile: AudioBytesReader, promptForApiKey: ApiKeyPrompt) {
		this.secretStorage = secretStorage;
		this.readAudioFile = readAudioFile;
		this.promptForApiKey = promptForApiKey;
	}

	/** Sets the transcription language. `'auto'` uses Deepgram's multilingual mode. */
	setLanguage(language: string): void {
		this._language = language;
	}

	async transcribe(source: string, glossary?: string[]): Promise<TranscriptionResult> {
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		const audioBuffer = await this.readAudioFile(source);
		const isAutoLanguage = this._language === 'auto';
		const options: Record<string, unknown> = {
			model: 'nova-3',
			language: isAutoLanguage ? 'multi' : this._language,
			smart_format: true,
			...(isAutoLanguage ? { detect_language: true } : {}),
		};

		if (glossary?.length) {
			options.keyterm = this.truncateKeyterms(glossary);
		}

		let response: any;
		try {
			response = await client.listen.prerecorded.transcribeFile(audioBuffer, options);
		} catch (err: unknown) {
			if (err instanceof Error && ((err as any).status === 401 || (err as any).status === 403)) {
				this._client = null;
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(
					'Invalid Deepgram API key. It has been removed — you will be prompted again on next use.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Transcription failed: ${detail}`);
		}

		// Deepgram SDK returns { result, error } union — check for error response
		if (response?.error) {
			const errMsg = response.error?.message || JSON.stringify(response.error);
			throw new Error(`Transcription failed: ${errMsg}`);
		}

		if (!response?.result) {
			console.error('[Verba] Deepgram response has no result:', JSON.stringify(response, null, 2).substring(0, 500));
			throw new Error('Transcription failed: Deepgram returned no result');
		}

		const channel = response.result.results?.channels?.[0];
		const rawText = channel?.alternatives?.[0]?.transcript || '';
		const detectedLanguage: string | undefined = channel?.detected_language || undefined;
		console.log(`[Verba] Deepgram raw response (${rawText.length} chars, lang=${detectedLanguage ?? 'unknown'}): ${rawText.substring(0, 200)}`);

		return { text: validateTranscript(rawText), detectedLanguage };
	}

	/**
	 * Truncates glossary terms to fit within Deepgram's 500-token keyterm budget.
	 * Each keyterm is formatted as `term:2` (boost weight). Token count is estimated
	 * using character length (BPE ≈ 1 token per 3 characters), with a safety margin.
	 */
	private truncateKeyterms(glossary: string[]): string[] {
		const MAX_TOKENS = 200; // Very conservative — Deepgram's BPE tokenizer counts significantly more than char/3 estimate; hard limit is 500
		const keyterms: string[] = [];
		let tokenCount = 0;

		for (const term of glossary) {
			const kt = `${term}:2`;
			// BPE tokenizers produce roughly 1 token per 3 characters (conservative)
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

	private getClient(apiKey: string): any {
		if (!this._client) {
			const { createClient } = getDeepgramSdk();
			this._client = createClient(apiKey);
		}
		return this._client;
	}
}
