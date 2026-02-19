import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export class FfmpegRecorder {
	private process: ChildProcess | null = null;
	private _outputPath: string = '';
	private _isRecording: boolean = false;

	get isRecording(): boolean {
		return this._isRecording;
	}

	get outputPath(): string {
		return this._outputPath;
	}

	async start(): Promise<void> {
		if (this._isRecording) {
			throw new Error('Recording already in progress');
		}

		const ffmpegPath = this.findFfmpeg();
		if (!ffmpegPath) {
			throw new Error('ffmpeg not found. Install it via: brew install ffmpeg');
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		this._outputPath = path.join(os.tmpdir(), `verba-recording-${timestamp}.wav`);

		this.process = spawn(ffmpegPath, [
			'-f', 'avfoundation',
			'-i', ':default',
			'-ar', '16000',
			'-ac', '1',
			'-acodec', 'pcm_s16le',
			'-y',
			this._outputPath,
		], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.process.on('error', (err) => {
			this._isRecording = false;
			this.process = null;
			throw new Error(`ffmpeg process error: ${err.message}`);
		});

		// Wait 500ms to catch startup errors (e.g. no microphone permission)
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (this.process && !this.process.killed) {
					this._isRecording = true;
					resolve();
				}
			}, 500);

			this.process!.on('close', (code) => {
				if (!this._isRecording) {
					clearTimeout(timeout);
					reject(new Error(
						code === 1
							? 'Microphone access denied. Check System Settings > Privacy > Microphone.'
							: `ffmpeg exited unexpectedly with code ${code}`
					));
				}
				this._isRecording = false;
				this.process = null;
			});
		});
	}

	async stop(): Promise<string> {
		if (!this._isRecording || !this.process) {
			throw new Error('No recording in progress');
		}

		return new Promise<string>((resolve, reject) => {
			const killTimeout = setTimeout(() => {
				if (this.process) {
					this.process.kill('SIGKILL');
				}
			}, 3000);

			this.process!.on('close', () => {
				clearTimeout(killTimeout);
				this._isRecording = false;
				this.process = null;

				// Verify the file exists and is not empty
				try {
					const stats = fs.statSync(this._outputPath);
					if (stats.size <= 44) { // 44 bytes = WAV header only
						reject(new Error('Recording is empty. No audio was captured.'));
						return;
					}
				} catch {
					reject(new Error('Recording file was not created.'));
					return;
				}

				resolve(this._outputPath);
			});

			// Send 'q' to stdin for graceful shutdown (correct WAV headers)
			this.process!.stdin!.write('q');
		});
	}

	dispose(): void {
		if (this.process) {
			this.process.kill('SIGKILL');
			this.process = null;
		}
		this._isRecording = false;
	}

	private findFfmpeg(): string | null {
		const candidates = [
			'/opt/homebrew/bin/ffmpeg',
			'/usr/local/bin/ffmpeg',
		];

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}

		// Fallback: try to find via which
		try {
			const result = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
			if (result) {
				return result;
			}
		} catch {
			// which failed, ffmpeg not in PATH
		}

		return null;
	}
}
