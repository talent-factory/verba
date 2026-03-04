import Anthropic from '@anthropic-ai/sdk';
import { ProcessingStage, PipelineContext } from './pipeline';

export interface Expansion {
	abbreviation: string;
	expansion: string;
}

/** Strips newlines and normalizes quotes in user-provided text to prevent
 *  formatting disruption when embedded in LLM system prompts. */
function sanitize(s: string): string {
	return s.replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
}

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

/** Maximum number of attempts for overloaded (529) errors before giving up. */
const MAX_ATTEMPTS = 3;
/** Base delay in milliseconds for exponential backoff between retry attempts. */
const RETRY_BASE_DELAY_MS = 1000;

/** Returns true when `err` is an Anthropic 529 "overloaded" error. */
function isOverloadedError(err: unknown): boolean {
	return err instanceof Error && (err as any).status === 529;
}

/**
 * Cleans up a raw transcript using Claude API: removes filler words,
 * smooths sentences, corrects transcription errors, preserves glossary terms,
 * expands text abbreviations, and handles selection context for transform operations.
 * Supports both single-request (process) and streaming (processStreaming) modes.
 * API key is managed via a SecretStorage abstraction; in production, backed by VS Code's secret store.
 */
export class CleanupService implements ProcessingStage {
	readonly name = 'Text Cleanup';
	private _client: Anthropic | null = null;
	private secretStorage: SecretStorage;
	private glossary: string[] = [];
	private expansions: Expansion[] = [];
	/** Token usage from the most recent API call, or undefined if unavailable. */
	lastUsage?: { inputTokens: number; outputTokens: number };

	/** Sets the glossary terms that must be preserved verbatim during cleanup. */
	setGlossary(terms: string[]): void {
		this.glossary = [...terms];
	}

	/** Sets the text expansions (abbreviation → full text) applied during cleanup. */
	setExpansions(expansions: Expansion[]): void {
		this.expansions = [...expansions];
	}

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	/** Optional callback invoked before each retry attempt (e.g. to update the status bar). */
	onRetry?: (attempt: number, maxAttempts: number) => void;

	/** Cleans up the transcript in a single (non-streaming) API call. */
	async process(input: string, context?: PipelineContext): Promise<string> {
		const { client, systemPrompt, userMessage } = await this.prepareRequest(context, input);

		const requestParams = {
			model: 'claude-haiku-4-5-20251001' as const,
			max_tokens: 4096,
			system: systemPrompt,
			messages: [{ role: 'user' as const, content: userMessage }],
		};

		let response;
		let lastError: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				response = await client.messages.create(requestParams);
				break;
			} catch (err: unknown) {
				lastError = err;
				if (isOverloadedError(err) && attempt < MAX_ATTEMPTS) {
					const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
					console.log(`[Verba] API overloaded (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms…`);
					this.onRetry?.(attempt + 1, MAX_ATTEMPTS);
					await this.sleep(delay);
					continue;
				}
				await this.handleApiError(err, '[Verba] Claude API call failed:'); // always throws
			}
		}

		if (!response) {
			await this.handleApiError(lastError, '[Verba] Claude API call failed:');
		}

		this.lastUsage = response!.usage
			? { inputTokens: response!.usage.input_tokens, outputTokens: response!.usage.output_tokens }
			: undefined;

		const text = response!.content[0]?.type === 'text'
			? response!.content[0].text
			: '';

		console.log(`[Verba] Claude response (${(text || '').length} chars): ${(text || '').substring(0, 200)}`);

		return this.fallbackIfEmpty(text, input, !!context?.selectedText);
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

		const requestParams = {
			model: 'claude-haiku-4-5-20251001' as const,
			max_tokens: 4096,
			system: systemPrompt,
			messages: [{ role: 'user' as const, content: userMessage }],
		};

		let accumulated = '';
		let lastError: unknown;

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			accumulated = '';

			const stream = client.messages.stream(requestParams);

			const abortHandler = () => { stream.abort(); };
			if (signal) {
				signal.addEventListener('abort', abortHandler, { once: true });
			}

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

				try {
					const finalMsg = await stream.finalMessage();
					this.lastUsage = finalMsg.usage
						? { inputTokens: finalMsg.usage.input_tokens, outputTokens: finalMsg.usage.output_tokens }
						: undefined;
				} catch (err: unknown) {
					console.error('[Verba] Failed to extract usage from streaming response — Claude cost not tracked:', err);
					this.lastUsage = undefined;
				}

				break; // success — exit retry loop
			} catch (err: unknown) {
				lastError = err;
				if (signal?.aborted) {
					const abortError = new Error('Dictation cancelled');
					abortError.name = 'AbortError';
					throw abortError;
				}
				if (isOverloadedError(err) && attempt < MAX_ATTEMPTS) {
					const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
					console.log(`[Verba] API overloaded during streaming (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms…`);
					this.onRetry?.(attempt + 1, MAX_ATTEMPTS);
					await this.sleep(delay);
					continue;
				}
				await this.handleApiError(err, '[Verba] Claude API streaming failed:');
			} finally {
				if (signal) {
					signal.removeEventListener('abort', abortHandler);
				}
			}
		}

		console.log(`[Verba] Claude streaming response (${accumulated.length} chars): ${accumulated.substring(0, 200)}`);

		return this.fallbackIfEmpty(accumulated, input, !!context?.selectedText);
	}

	private async prepareRequest(
		context: PipelineContext | undefined,
		input: string,
	): Promise<{ client: Anthropic; systemPrompt: string; userMessage: string }> {
		const langCode = context?.detectedLanguage;
		const languageHint = langCode && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(langCode)
			? `\nThe transcript language is: ${langCode}. Respond in the same language.\n`
			: '';
		const glossaryInstruction = this.glossary.length > 0
			? `\nBehalte folgende Begriffe exakt bei (nicht uebersetzen, nicht kuerzen, nicht aendern): ${this.glossary.join(', ')}.`
			: '';
		const expansionInstruction = this.expansions.length > 0
			? `\nExpandiere folgende Abkuerzungen im Text (ersetze die Kurzform durch die Langform): ${this.expansions.map(e => `"${sanitize(e.abbreviation)}" → "${sanitize(e.expansion)}"`).join(', ')}.`
			: '';
		const systemPrompt = context?.templatePrompt
			? TEMPLATE_FRAMING + languageHint + glossaryInstruction + expansionInstruction + '\n' + context.templatePrompt
			: CLEANUP_SYSTEM_PROMPT + languageHint + glossaryInstruction + expansionInstruction;
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		const contextBlock = context?.contextSnippets?.length
			? `<context>\n${context.contextSnippets.join('\n\n')}\n</context>\n\n`
			: '';
		const selectionBlock = context?.selectedText
			? `<selection>\n${context.selectedText}\n</selection>\n\n`
			: '';
		const userMessage = `${contextBlock}${selectionBlock}<transcript>\n${input}\n</transcript>`;

		return { client, systemPrompt, userMessage };
	}

	private async handleApiError(err: unknown, logPrefix: string): Promise<never> {
		console.error(logPrefix, err);
		if (err instanceof Error && (err as any).status === 401) {
			this._client = null;
			try {
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
			} catch (deleteErr: unknown) {
				console.error('[Verba] Failed to remove invalid Anthropic API key from storage:', deleteErr);
			}
			throw new Error(
				'Invalid Anthropic API key. Please update it via "Verba: Manage API Keys".'
			);
		}
		if (err instanceof Error && (err as any).status === 429) {
			throw new Error(
				'Anthropic rate limit reached. Please wait a moment and try again.'
			);
		}
		if (isOverloadedError(err)) {
			throw new Error(
				'Anthropic API is currently overloaded. Please try again in a few seconds.'
			);
		}
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Post-processing failed: ${detail}`);
	}

	private fallbackIfEmpty(text: string, rawInput: string, hasSelection: boolean): string {
		if (!text || text.trim() === '') {
			if (hasSelection) {
				console.error('[Verba] Claude returned empty response during selection transform.');
				throw new Error(
					'Post-processing returned an empty response. Your selection was not modified. Try again or check your API key.'
				);
			}
			console.warn('[Verba] Claude returned empty response; skipping cleanup and using raw transcript.');
			try {
				// Lazy-load vscode module so pure functions remain testable outside the extension host.
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const vs: typeof import('vscode') = require('vscode');
				vs.window.showWarningMessage('Verba: Post-processing returned an empty response. Inserting raw transcript instead.');
			} catch (err: unknown) {
				if (!(err instanceof Error && err.message.includes('Cannot find module'))) {
					console.warn('[Verba] Failed to show empty-response warning:', err);
				}
			}
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

	/** Sleeps for the given number of milliseconds. Extracted for test stubbing. */
	protected sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private getClient(apiKey: string): Anthropic {
		if (!this._client) {
			this._client = new Anthropic({ apiKey });
		}
		return this._client;
	}
}
