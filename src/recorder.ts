import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export class FfmpegRecorder {
	private process: ChildProcess | null = null;
	private _outputPath: string = '';
	private _isRecording: boolean = false;
	private closeHandler: (() => void) | null = null;

	onUnexpectedStop?: (error: Error) => void;

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

		if (process.platform !== 'darwin') {
			throw new Error('Microphone recording is currently only supported on macOS.');
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

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (this.process && !this.process.killed) {
					this._isRecording = true;
					resolve();
				} else {
					this.cleanup();
					reject(new Error(
						'ffmpeg process terminated unexpectedly during startup. '
						+ 'Check that ffmpeg is installed correctly and microphone access is granted.'
					));
				}
			}, 500);

			this.process!.on('error', (err) => {
				clearTimeout(timeout);
				this.cleanup();
				reject(new Error(`ffmpeg failed to start: ${err.message}`));
			});

			this.closeHandler = () => {
				if (this._isRecording) {
					// Mid-recording crash
					this._isRecording = false;
					this.process = null;
					this.onUnexpectedStop?.(new Error(
						'Recording stopped unexpectedly (ffmpeg process exited)'
					));
				}
			};

			this.process!.on('close', (code) => {
				if (!this._isRecording) {
					clearTimeout(timeout);
					this.cleanup();
					reject(new Error(
						code === 1
							? 'Microphone access denied. Check System Settings > Privacy > Microphone.'
							: `ffmpeg exited unexpectedly with code ${code}`
					));
					return;
				}
				this.closeHandler?.();
			});
		});
	}

	async stop(): Promise<string> {
		if (!this._isRecording || !this.process) {
			throw new Error('No recording in progress');
		}

		const proc = this.process;

		return new Promise<string>((resolve, reject) => {
			const killTimeout = setTimeout(() => {
				proc.kill('SIGKILL');
			}, 3000);

			const ultimateTimeout = setTimeout(() => {
				this.cleanup();
				reject(new Error(
					'Failed to stop recording: ffmpeg did not exit within 5 seconds. '
					+ `The recording file may be incomplete: ${this._outputPath}`
				));
			}, 5000);

			// Replace the mid-recording crash handler with stop handler
			this.closeHandler = null;
			proc.removeAllListeners('close');
			proc.on('close', () => {
				clearTimeout(killTimeout);
				clearTimeout(ultimateTimeout);
				this._isRecording = false;
				this.process = null;

				try {
					const stats = fs.statSync(this._outputPath);
					if (stats.size <= 44) { // 44 bytes = WAV header only
						reject(new Error('Recording is empty. No audio was captured.'));
						return;
					}
				} catch (err: unknown) {
					const code = err instanceof Error && 'code' in err
						? (err as NodeJS.ErrnoException).code
						: undefined;
					if (code === 'ENOENT') {
						reject(new Error('Recording file was not created.'));
					} else {
						const detail = err instanceof Error ? err.message : String(err);
						reject(new Error(`Cannot access recording file: ${detail}`));
					}
					return;
				}

				resolve(this._outputPath);
			});

			// Send 'q' to stdin for graceful shutdown (correct WAV headers)
			if (proc.stdin && !proc.stdin.destroyed) {
				proc.stdin.write('q', (err) => {
					if (err) {
						proc.kill('SIGKILL');
					}
				});
			} else {
				proc.kill('SIGKILL');
			}
		});
	}

	dispose(): void {
		if (this.process) {
			this.process.kill('SIGKILL');
			this.process = null;
		}
		this._isRecording = false;
		if (this._outputPath) {
			try { fs.unlinkSync(this._outputPath); } catch { /* best effort */ }
		}
	}

	private cleanup(): void {
		this._isRecording = false;
		this.process = null;
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

		try {
			const result = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
			if (result) {
				return result;
			}
		} catch {
			// execSync can throw for various reasons (command not found, timeout, etc.)
		}

		return null;
	}
}
