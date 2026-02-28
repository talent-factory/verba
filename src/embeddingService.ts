import OpenAI from 'openai';

const API_KEY_STORAGE_KEY = 'openai-api-key';
// text-embedding-3-small supports 8192 tokens.
// 8000 chars provides a comfortable safety margin for typical char/token ratios.
const MAX_EMBEDDING_CHARS = 8000;

interface SecretStorage {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Generates text embeddings via the OpenAI `text-embedding-3-small` model.
 * Used for building the local vector index and for context-aware template queries.
 * API key is shared with the Whisper transcription service (stored in SecretStorage).
 */
export class EmbeddingService {
	private _client: OpenAI | null = null;
	private secretStorage: SecretStorage;
	/** Token usage from the most recent API call, or undefined if unavailable. */
	lastUsage?: { promptTokens: number };

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	/** Embeds a single text string and returns its vector. */
	async embed(text: string): Promise<number[]> {
		const vectors = await this.embedBatch([text]);
		return vectors[0];
	}

	/** Embeds multiple texts in a single API call. Truncates inputs exceeding 8000 characters. */
	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}

		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		const truncated = texts.map(t => t.length > MAX_EMBEDDING_CHARS ? t.slice(0, MAX_EMBEDDING_CHARS) : t);

		let response;
		try {
			response = await client.embeddings.create({
				model: 'text-embedding-3-small',
				input: truncated,
			});
		} catch (err: unknown) {
			if (err instanceof Error && (err as any).status === 401) {
				this._client = null;
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(
					'Invalid OpenAI API key. It has been removed — you will be prompted again on next use.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Embedding failed: ${detail}`);
		}

		this.lastUsage = response.usage
			? { promptTokens: response.usage.prompt_tokens }
			: undefined;

		return response.data.map(d => d.embedding);
	}

	private async getApiKey(): Promise<string> {
		const stored = await this.secretStorage.get(API_KEY_STORAGE_KEY);
		if (stored) {
			return stored;
		}
		throw new Error('OpenAI API key required for embeddings. Set it up via Whisper transcription first.');
	}

	private getClient(apiKey: string): OpenAI {
		if (!this._client) {
			this._client = new OpenAI({ apiKey });
		}
		return this._client;
	}
}
