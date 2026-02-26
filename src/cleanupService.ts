import Anthropic from '@anthropic-ai/sdk';
import { ProcessingStage, PipelineContext } from './pipeline';

const API_KEY_STORAGE_KEY = 'anthropic-api-key';

const COURSE_CORRECTION_INSTRUCTION = 'Erkenne und entferne Selbstkorrekturen (z.B. "nein warte", "ich meinte", "also doch", "beziehungsweise", "korrektur"). Behalte nur die finale, korrigierte Aussage.';

const VOICE_COMMANDS_INSTRUCTION = `Erkenne gesprochene Sprachbefehle fuer Formatierung und ersetze sie durch die entsprechende Formatierung. Die Befehle koennen in jeder Sprache kommen. Nutze den Kontext, um Mehrdeutigkeiten aufzuloesen (z.B. "Punkt" als Satzende vs. inhaltliches Wort).
Befehle: "Neuer Absatz"/"New paragraph" → Absatzumbruch, "Neue Zeile"/"New line" → Zeilenumbruch, "Punkt"/"Period" → ., "Komma"/"Comma" → ,, "Doppelpunkt"/"Colon" → :, "Semikolon"/"Semicolon" → ;, "Fragezeichen"/"Question mark" → ?, "Ausrufezeichen"/"Exclamation mark" → !, "Aufzaehlung"/"Bullet point" → Aufzaehlungspunkt (- ), "Nummer eins/zwei/drei"/"Number one/two/three" → Nummerierung (1. /2. /3. ).`;

const TEMPLATE_FRAMING = `The user message contains a raw speech transcript wrapped in <transcript> tags. Process it according to the following instructions and return ONLY the processed result — no commentary, no explanation, no preamble.

Important: The transcript is raw speech. ${COURSE_CORRECTION_INSTRUCTION} ${VOICE_COMMANDS_INSTRUCTION}

`;

const CLEANUP_SYSTEM_PROMPT = `Du erhältst ein rohes Sprach-Transkript in <transcript> Tags. Bereinige es:
- Entferne Füllwörter (ähm, äh, halt, eigentlich, sozusagen, quasi, irgendwie, etc.)
- Glätte abgebrochene oder wiederholte Satzanfänge
- ${COURSE_CORRECTION_INSTRUCTION}
- ${VOICE_COMMANDS_INSTRUCTION}
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
 * smooths sentences, corrects transcription errors, and preserves glossary terms.
 * Supports both synchronous (process) and streaming (processStreaming) modes.
 * API key is managed via a SecretStorage abstraction; in production, backed by VS Code's secret store.
 */
export class CleanupService implements ProcessingStage {
	readonly name = 'Text Cleanup';
	private _client: Anthropic | null = null;
	private secretStorage: SecretStorage;
	private glossary: string[] = [];

	/** Sets the glossary terms that must be preserved verbatim during cleanup. */
	setGlossary(terms: string[]): void {
		this.glossary = [...terms];
	}

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	/** Cleans up the transcript in a single (non-streaming) API call. */
	async process(input: string, context?: PipelineContext): Promise<string> {
		const { client, systemPrompt, userMessage } = await this.prepareRequest(context, input);

		let response;
		try {
			response = await client.messages.create({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 4096,
				system: systemPrompt,
				messages: [{ role: 'user', content: userMessage }],
			});
		} catch (err: unknown) {
			this.handleApiError(err, '[Verba] Claude API call failed:');
		}

		const text = response.content[0]?.type === 'text'
			? response.content[0].text
			: '';

		console.log(`[Verba] Claude response (${(text || '').length} chars): ${(text || '').substring(0, 200)}`);

		return this.fallbackIfEmpty(text, input);
	}

	/**
	 * Cleans up the transcript using Claude's streaming API.
	 * @param onChunk - Called with the accumulated character count as chunks arrive.
	 * @param signal - Optional AbortSignal to cancel the stream mid-flight.
	 */
	async processStreaming(
		input: string,
		context: PipelineContext | undefined,
		onChunk: (charCount: number) => void,
		signal?: AbortSignal,
	): Promise<string> {
		const { client, systemPrompt, userMessage } = await this.prepareRequest(context, input);

		const stream = client.messages.stream({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 4096,
			system: systemPrompt,
			messages: [{ role: 'user', content: userMessage }],
		});

		const abortHandler = () => { stream.abort(); };
		if (signal) {
			signal.addEventListener('abort', abortHandler, { once: true });
		}

		let accumulated = '';
		try {
			for await (const event of stream) {
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					accumulated += event.delta.text;
					try {
						onChunk(accumulated.length);
					} catch (callbackErr) {
						console.warn('[Verba] onChunk callback failed (non-fatal):', callbackErr);
					}
				}
			}
		} catch (err: unknown) {
			if (signal?.aborted) {
				const abortError = new Error('Dictation cancelled');
				abortError.name = 'AbortError';
				throw abortError;
			}
			this.handleApiError(err, '[Verba] Claude API streaming failed:');
		} finally {
			if (signal) {
				signal.removeEventListener('abort', abortHandler);
			}
		}

		console.log(`[Verba] Claude streaming response (${accumulated.length} chars): ${accumulated.substring(0, 200)}`);

		return this.fallbackIfEmpty(accumulated, input);
	}

	private async prepareRequest(
		context: PipelineContext | undefined,
		input: string,
	): Promise<{ client: Anthropic; systemPrompt: string; userMessage: string }> {
		const glossaryInstruction = this.glossary.length > 0
			? `\nBehalte folgende Begriffe exakt bei (nicht uebersetzen, nicht kuerzen, nicht aendern): ${this.glossary.join(', ')}.`
			: '';
		const systemPrompt = context?.templatePrompt
			? TEMPLATE_FRAMING + glossaryInstruction + '\n' + context.templatePrompt
			: CLEANUP_SYSTEM_PROMPT + glossaryInstruction;
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		const contextBlock = context?.contextSnippets?.length
			? `<context>\n${context.contextSnippets.join('\n\n')}\n</context>\n\n`
			: '';
		const userMessage = `${contextBlock}<transcript>\n${input}\n</transcript>`;

		return { client, systemPrompt, userMessage };
	}

	private handleApiError(err: unknown, logPrefix: string): never {
		console.error(logPrefix, err);
		if (err instanceof Error && (err as any).status === 401) {
			this._client = null;
			Promise.resolve(this.secretStorage.delete(API_KEY_STORAGE_KEY)).catch((deleteErr: unknown) => {
				console.error('[Verba] Failed to remove invalid Anthropic API key from storage:', deleteErr);
			});
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

	private fallbackIfEmpty(text: string, rawInput: string): string {
		if (!text || text.trim() === '') {
			console.warn('[Verba] Claude returned empty response; skipping cleanup and using raw transcript.');
			return rawInput;
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
