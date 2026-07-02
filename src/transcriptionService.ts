import * as fs from 'fs';
import { SecretStore } from './core/adapters';
import { TranscriptionResult } from './core/transcription';
import { DeepgramProvider } from './core/deepgramProvider';
import { LocalWhisperProvider } from './localWhisperProvider';

/** Transcription backend selection: `'deepgram'` for cloud API, `'local'` for whisper.cpp CLI. */
export type TranscriptionProvider = 'deepgram' | 'local';

// Re-exported for backward compatibility; the canonical definition lives in ./core/transcription.
export type { TranscriptionResult };

/**
 * Orchestrates transcription across the cloud (Deepgram) and local (whisper.cpp)
 * backends. `setProvider()` selects the active one; `process()` delegates to it.
 *
 * The portable Deepgram logic lives in `@verba/core` ({@link DeepgramProvider});
 * the desktop-only whisper.cpp logic lives in {@link LocalWhisperProvider}. This
 * class keeps a stable public surface for the extension and injects the host's
 * filesystem reader and API-key prompt into the core provider.
 */
export class TranscriptionService {
	readonly name = 'Deepgram Transcription';
	private _provider: TranscriptionProvider = 'deepgram';
	private readonly deepgramProvider: DeepgramProvider;
	private readonly localProvider: LocalWhisperProvider;

	constructor(secretStorage: SecretStore) {
		this.deepgramProvider = new DeepgramProvider(
			secretStorage,
			(source: string) => fs.readFileSync(source),
			() => this.promptForApiKey(),
		);
		this.localProvider = new LocalWhisperProvider();
	}

	/** Switches the transcription backend. Throws on invalid provider values. */
	setProvider(provider: TranscriptionProvider): void {
		if (provider !== 'deepgram' && provider !== 'local') {
			throw new Error(`Invalid provider: ${provider}. Must be 'deepgram' or 'local'.`);
		}
		this._provider = provider;
	}

	/** Sets the language for Deepgram transcription. `'auto'` uses multilingual mode. */
	setLanguage(language: string): void {
		this.deepgramProvider.setLanguage(language);
	}

	/** Sets the absolute path to the GGML model file used by the local whisper.cpp provider. */
	setModelPath(modelPath: string): void {
		this.localProvider.setModelPath(modelPath);
	}

	/**
	 * Transcribes a WAV audio file to text using the active provider.
	 * @param input - Absolute path to the WAV file.
	 * @param glossary - Optional terms to bias transcription accuracy.
	 */
	async process(input: string, glossary?: string[]): Promise<TranscriptionResult> {
		const backend = this._provider === 'local' ? this.localProvider : this.deepgramProvider;
		return backend.transcribe(input, glossary);
	}

	/** Override point for tests. In production, shows vscode.window.showInputBox. */
	protected async promptForApiKey(): Promise<string | undefined> {
		throw new Error('promptForApiKey not implemented');
	}
}
