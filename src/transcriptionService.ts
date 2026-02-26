import * as fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import OpenAI from 'openai';

const API_KEY_STORAGE_KEY = 'openai-api-key';

/** Transcription backend: `'openai'` for cloud Whisper API, `'local'` for whisper.cpp CLI. */
export type TranscriptionProvider = 'openai' | 'local';

interface SecretStorage {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Transcribes WAV audio files via OpenAI Whisper API or local whisper.cpp CLI.
 * Provider is selected via setProvider(). An optional glossary biases transcription.
 * API key (for OpenAI) is stored in VS Code SecretStorage; prompts user on first use.
 */
export class TranscriptionService {
	readonly name = 'Whisper Transcription';
	private _client: OpenAI | null = null;
	private secretStorage: SecretStorage;
	private _provider: TranscriptionProvider = 'openai';
	private _modelPath: string = '';

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	/** Switches the transcription backend. Throws on invalid provider values. */
	setProvider(provider: TranscriptionProvider): void {
		if (provider !== 'openai' && provider !== 'local') {
			throw new Error(`Invalid provider: ${provider}. Must be 'openai' or 'local'.`);
		}
		this._provider = provider;
	}

	/** Sets the absolute path to the GGML model file used by the local whisper.cpp provider. */
	setModelPath(modelPath: string): void {
		this._modelPath = modelPath;
	}

	/**
	 * Transcribes a WAV audio file to text using the active provider.
	 * @param input - Absolute path to the WAV file.
	 * @param glossary - Optional terms to bias transcription accuracy (passed as prompt hint to both OpenAI and whisper.cpp).
	 */
	async process(input: string, glossary?: string[]): Promise<string> {
		if (this._provider === 'local') {
			return this.processLocal(input, glossary);
		}
		return this.processOpenAI(input, glossary);
	}

	private async processOpenAI(input: string, glossary?: string[]): Promise<string> {
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		const prompt = glossary?.length ? glossary.join(', ') : undefined;
		let transcription;
		try {
			transcription = await client.audio.transcriptions.create({
				file: fs.createReadStream(input),
				model: 'whisper-1',
				...(prompt && { prompt }),
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

		return this.validateTranscript(rawText);
	}

	private async processLocal(input: string, glossary?: string[]): Promise<string> {
		if (!this._modelPath) {
			throw new Error(
				'No whisper model configured. Run "Verba: Download Whisper Model" to download a model.'
			);
		}

		const whisperPath = this.findWhisperCpp();
		if (!whisperPath) {
			throw new Error(
				'whisper-cli not found. Install it via: brew install whisper-cpp'
			);
		}

		if (!fs.existsSync(this._modelPath)) {
			throw new Error(
				`Whisper model not found at ${this._modelPath}. Run "Verba: Download Whisper Model" to download a model.`
			);
		}

		const args = [
			'-m', this._modelPath,
			'-f', input,
			'-np',
			'-l', 'auto',
		];

		const prompt = glossary?.length ? glossary.join(', ') : undefined;
		if (prompt) {
			args.push('--prompt', prompt);
		}

		const { stdout, stderr, exitCode, timedOut } = await this.spawnWhisper(whisperPath, args);

		if (timedOut) {
			throw new Error(
				'Local transcription timed out. The audio file may be too long or the model too large. Try a smaller model.'
			);
		}

		if (exitCode !== 0) {
			throw new Error(
				`Local transcription failed (exit code ${exitCode}): ${stderr}`
			);
		}

		const rawOutput = stdout.trim();
		console.log(`[Verba] whisper.cpp raw output (${rawOutput.length} chars): ${rawOutput.substring(0, 200)}`);

		// whisper-cli may output timestamp-prefixed lines: [00:00:00.000 --> 00:00:03.000]  text
		const text = rawOutput
			.split('\n')
			.map(line => line.replace(/^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, '').trim())
			.filter(line => line.length > 0)
			.join(' ')
			.trim();

		return this.validateTranscript(text);
	}

	/** Runs whisper-cli asynchronously to avoid blocking the VS Code extension host. Times out after 120 s. */
	private spawnWhisper(binary: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
		return new Promise((resolve, reject) => {
			const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			let settled = false;

			proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
			proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

			const timer = setTimeout(() => {
				timedOut = true;
				proc.kill('SIGTERM');
				// Escalate to SIGKILL if SIGTERM is ignored
				setTimeout(() => {
					try { proc.kill('SIGKILL'); } catch { /* already exited */ }
				}, 3000);
			}, 120000);

			proc.on('close', (code) => {
				if (settled) { return; }
				settled = true;
				clearTimeout(timer);
				resolve({ stdout, stderr: stderr.trim(), exitCode: code, timedOut });
			});

			proc.on('error', (err) => {
				if (settled) { return; }
				settled = true;
				clearTimeout(timer);
				reject(new Error(`Local transcription failed: ${err.message}`));
			});
		});
	}

	private validateTranscript(rawText: string): string {
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

	private findWhisperCpp(): string | null {
		const candidates = [
			'/opt/homebrew/bin/whisper-cli',
			'/usr/local/bin/whisper-cli',
		];

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}

		// Fallback: resolve via PATH (macOS/Linux only; Windows uses 'where')
		if (process.platform !== 'win32') {
			try {
				const result = spawnSync('which', ['whisper-cli'], {
					encoding: 'utf-8',
					timeout: 5000,
				});
				const found = (result.stdout || '').trim();
				if (found) {
					return found;
				}
			} catch (err: unknown) {
				const detail = err instanceof Error ? err.message : String(err);
				console.warn(`[Verba] 'which whisper-cli' lookup failed: ${detail}`);
			}
		}

		return null;
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
