/**
 * LocalWhisperProvider — offline transcription via the whisper.cpp CLI.
 *
 * Desktop-only: depends on `fs`, `child_process`, and `process.platform`, so it
 * lives in the host (extension) rather than in `@verba/core`. Implements the
 * shared {@link TranscriptionBackend} contract.
 */

import * as fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { TranscriptionBackend, TranscriptionResult, validateTranscript } from './core/transcription';

export class LocalWhisperProvider implements TranscriptionBackend {
	readonly name = 'Local Whisper Transcription';
	private _modelPath: string = '';

	/** Sets the absolute path to the GGML model file used by whisper.cpp. */
	setModelPath(modelPath: string): void {
		this._modelPath = modelPath;
	}

	async transcribe(source: string, glossary?: string[]): Promise<TranscriptionResult> {
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
			'-f', source,
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

		return { text: validateTranscript(text) };
	}

	/** Runs whisper-cli asynchronously to avoid blocking the extension host. Times out after 120 s. */
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
}
