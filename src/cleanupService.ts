import Anthropic from '@anthropic-ai/sdk';
import { ProcessingStage, PipelineContext } from './pipeline';

const API_KEY_STORAGE_KEY = 'anthropic-api-key';

const TEMPLATE_FRAMING = `The user message contains a raw speech transcript wrapped in <transcript> tags. Process it according to the following instructions and return ONLY the processed result — no commentary, no explanation, no preamble.

`;

const CLEANUP_SYSTEM_PROMPT = `Du erhältst ein rohes Sprach-Transkript in <transcript> Tags. Bereinige es:
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
 * API key is managed via a SecretStorage abstraction; in production, backed by VS Code's secret store.
 */
export class CleanupService implements ProcessingStage {
	readonly name = 'Text Cleanup';
	private _client: Anthropic | null = null;
	private secretStorage: SecretStorage;

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	async process(input: string, context?: PipelineContext): Promise<string> {
		const systemPrompt = context?.templatePrompt
			? TEMPLATE_FRAMING + context.templatePrompt
			: CLEANUP_SYSTEM_PROMPT;
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		const contextBlock = context?.contextSnippets?.length
			? `<context>\n${context.contextSnippets.join('\n\n')}\n</context>\n\n`
			: '';
		const userMessage = `${contextBlock}<transcript>\n${input}\n</transcript>`;

		let response;
		try {
			response = await client.messages.create({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 4096,
				system: systemPrompt,
				messages: [{ role: 'user', content: userMessage }],
			});
		} catch (err: unknown) {
			console.error('[Verba] Claude API call failed:', err);
			if (err instanceof Error && (err as any).status === 401) {
				this._client = null;
				try {
					await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				} catch (deleteErr: unknown) {
					console.error('[Verba] Failed to remove invalid Anthropic API key from storage:', deleteErr);
				}
				throw new Error(
					'Invalid Anthropic API key. It has been removed — you will be prompted again on next use.'
				);
			}
			if (err instanceof Error && (err as any).status === 429) {
				throw new Error(
					'Anthropic rate limit reached. Please wait a moment and try again.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Post-processing failed: ${detail}`);
		}

		const text = response.content[0]?.type === 'text'
			? response.content[0].text
			: '';

		console.log(`[Verba] Claude response (${(text || '').length} chars): ${(text || '').substring(0, 200)}`);

		if (!text || text.trim() === '') {
			console.warn('[Verba] Claude returned empty response; skipping cleanup and using raw transcript.');
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

	/** Override point for tests. In production, shows vscode.window.showInputBox. */
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
