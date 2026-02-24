import * as fs from 'fs';
import OpenAI from 'openai';
import { ProcessingStage } from './pipeline';

const API_KEY_STORAGE_KEY = 'openai-api-key';

interface SecretStorage {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Sends a WAV audio file to OpenAI Whisper API and returns the transcript.
 * Implements ProcessingStage: input is a file path, output is transcript text.
 * API key is stored in VS Code SecretStorage; prompts user on first use.
 */
export class TranscriptionService implements ProcessingStage {
	readonly name = 'Whisper Transcription';
	private _client: OpenAI | null = null;
	private secretStorage: SecretStorage;

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	async process(input: string): Promise<string> {
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		let transcription;
		try {
			transcription = await client.audio.transcriptions.create({
				file: fs.createReadStream(input),
				model: 'whisper-1',
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
			throw new Error(`Transcription failed: ${detail}`);
		}

		const rawText = transcription.text || '';
		console.log(`[Verba] Whisper raw response (${rawText.length} chars): ${rawText.substring(0, 200)}`);

		if (!rawText || rawText.trim() === '') {
			throw new Error('No speech detected in recording.');
		}

		// Whisper hallucinates dots/ellipsis when it receives audio without speech
		if (/^[\s.…]+$/.test(rawText)) {
			throw new Error(
				'No speech detected in recording (only silence). '
				+ 'Check that the correct microphone is selected — configure "verba.audioDevice" in Settings.'
			);
		}

		return rawText;
	}

	private async getApiKey(): Promise<string> {
		const stored = await this.secretStorage.get(API_KEY_STORAGE_KEY);
		if (stored) {
			return stored;
		}

		const key = await this.promptForApiKey();
		if (!key) {
			throw new Error(
				'OpenAI API key required for transcription.'
			);
		}

		await this.secretStorage.store(API_KEY_STORAGE_KEY, key);
		return key;
	}

	/** Override point for tests. In production, shows vscode.window.showInputBox. */
	protected async promptForApiKey(): Promise<string | undefined> {
		throw new Error('promptForApiKey not implemented');
	}

	private getClient(apiKey: string): OpenAI {
		if (!this._client) {
			this._client = new OpenAI({ apiKey });
		}
		return this._client;
	}
}
