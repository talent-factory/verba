import Anthropic from '@anthropic-ai/sdk';
import { ProcessingStage } from './pipeline';

const API_KEY_STORAGE_KEY = 'anthropic-api-key';

const CLEANUP_SYSTEM_PROMPT = `Du erhältst ein rohes Sprach-Transkript. Bereinige es:
- Entferne Füllwörter (ähm, äh, halt, eigentlich, sozusagen, quasi, irgendwie, etc.)
- Glätte abgebrochene oder wiederholte Satzanfänge
- Korrigiere offensichtliche Transkriptionsfehler
- Behalte den exakten Sinn und Stil bei
- Gib NUR den bereinigten Text zurück, ohne Erklärungen`;

interface SecretStorage {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Cleans up a raw transcript using Claude API: removes filler words,
 * smooths sentences, corrects transcription errors.
 * Implements ProcessingStage: input is raw transcript, output is cleaned text.
 * API key is stored in VS Code SecretStorage; prompts user on first use.
 */
export class CleanupService implements ProcessingStage {
	readonly name = 'Text Cleanup';
	private _client: Anthropic | null = null;
	private secretStorage: SecretStorage;

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	async process(input: string): Promise<string> {
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		let response;
		try {
			response = await client.messages.create({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 4096,
				system: CLEANUP_SYSTEM_PROMPT,
				messages: [{ role: 'user', content: input }],
			});
		} catch (err: unknown) {
			if (err instanceof Error && (err as any).status === 401) {
				this._client = null;
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(
					'Invalid Anthropic API key. It has been removed — you will be prompted again on next use.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Post-processing failed: ${detail}`);
		}

		const text = response.content[0]?.type === 'text'
			? response.content[0].text
			: '';

		if (!text || text.trim() === '') {
			return input;
		}

		return text;
	}

	private async getApiKey(): Promise<string> {
		const stored = await this.secretStorage.get(API_KEY_STORAGE_KEY);
		if (stored) {
			return stored;
		}

		const key = await this.promptForApiKey();
		if (!key) {
			throw new Error(
				'Anthropic API key required for post-processing.'
			);
		}

		await this.secretStorage.store(API_KEY_STORAGE_KEY, key);
		return key;
	}

	protected async promptForApiKey(): Promise<string | undefined> {
		throw new Error('promptForApiKey not implemented');
	}

	private getClient(apiKey: string): Anthropic {
		if (!this._client) {
			this._client = new Anthropic({ apiKey });
		}
		return this._client;
	}
}
