import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Records microphone audio to a WAV file using ffmpeg as a child process.
 *
 * Platform: macOS only (uses avfoundation input device).
 * External dependency: Requires ffmpeg to be installed.
 * Lifecycle: start() -> stop() returns file path, or dispose() for cleanup.
 * Graceful stop sends 'q' to stdin so ffmpeg finalizes WAV headers correctly.
 */
export class FfmpegRecorder {
	private process: ChildProcess | null = null;
	private _outputPath: string = '';
	private _isRecording: boolean = false;
	private closeHandler: (() => void) | null = null;

	/**
	 * Called when the ffmpeg process exits unexpectedly during an active recording.
	 * Not called during the startup phase or after stop() is initiated.
	 * isRecording will be false when this callback fires.
	 */
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
			let settled = false;
			const safeResolve = () => {
				if (!settled) { settled = true; resolve(); }
			};
			const safeReject = (err: Error) => {
				if (!settled) { settled = true; reject(err); }
			};

			// Heuristic: if ffmpeg hasn't crashed within 500ms, treat it as
			// successfully started. There is no explicit "ready" signal from ffmpeg.
			const timeout = setTimeout(() => {
				if (this.process && !this.process.killed) {
					this._isRecording = true;
					safeResolve();
				} else {
					this.cleanup();
					safeReject(new Error(
						'ffmpeg process terminated unexpectedly during startup. '
						+ 'Check that ffmpeg is installed correctly and microphone access is granted.'
					));
				}
			}, 500);

			this.process!.on('error', (err) => {
				clearTimeout(timeout);
				this.cleanup();
				safeReject(new Error(`ffmpeg failed to start: ${err.message}`));
			});

			this.closeHandler = () => {
				if (this._isRecording) {
					this._isRecording = false;
					this.process = null;
					const error = new Error(
						'Recording stopped unexpectedly (ffmpeg process exited)'
					);
					console.error('[Verba]', error.message);
					if (this.onUnexpectedStop) {
						this.onUnexpectedStop(error);
					}
				}
			};

			this.process!.on('close', (code) => {
				if (!this._isRecording) {
					clearTimeout(timeout);
					this.cleanup();
					safeReject(new Error(
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
			// Two-stage shutdown: try graceful quit via stdin 'q', escalate to
			// SIGKILL after 3s, give up entirely after 5s to avoid hanging.
			const killTimeout = setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process already exited between timeout firing and kill()
				}
			}, 3000);

			const ultimateTimeout = setTimeout(() => {
				this.cleanup();
				reject(new Error(
					'Failed to stop recording: ffmpeg did not exit within 5 seconds. '
					+ `The recording file may be incomplete: ${this._outputPath}`
				));
			}, 5000);

			// Detach the mid-recording crash handler and install a close listener for graceful stop
			this.closeHandler = null;
			proc.removeAllListeners('close');
			proc.on('close', () => {
				clearTimeout(killTimeout);
				clearTimeout(ultimateTimeout);
				this._isRecording = false;
				this.process = null;

				try {
					const stats = fs.statSync(this._outputPath);
					// WAV header is exactly 44 bytes; a file of 44 bytes or fewer contains no audio data
					if (stats.size <= 44) {
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
						console.warn(
							`[Verba] Graceful ffmpeg shutdown failed (${err.message}), forcing kill. `
							+ 'Recording file may have incomplete WAV headers.'
						);
						try {
							proc.kill('SIGKILL');
						} catch {
							// Process already exited
						}
					}
				});
			} else {
				console.warn('[Verba] ffmpeg stdin unavailable, forcing kill. Recording file may have incomplete WAV headers.');
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process already exited
				}
			}
		});
	}

	dispose(): void {
		if (this.process) {
			try {
				this.process.kill('SIGKILL');
			} catch (err: unknown) {
				const detail = err instanceof Error ? err.message : String(err);
				console.warn(`[Verba] Failed to kill ffmpeg process during dispose: ${detail}`);
			}
			this.process = null;
		}
		this._isRecording = false;
		if (this._outputPath) {
			try {
				fs.unlinkSync(this._outputPath);
			} catch (err: unknown) {
				const detail = err instanceof Error ? err.message : String(err);
				console.warn(`[Verba] Failed to clean up recording file ${this._outputPath}: ${detail}`);
			}
		}
	}

	private cleanup(): void {
		this._isRecording = false;
		this.process = null;
	}

	// Check common Homebrew paths first (avoids execSync overhead and PATH issues
	// in VS Code's sandboxed environment), then fall back to which(1).
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
			const result = execSync('which ffmpeg', {
				encoding: 'utf-8',
				timeout: 5000,
			}).trim();
			if (result) {
				return result;
			}
		} catch (err: unknown) {
			// which(1) exits non-zero when ffmpeg is not in PATH
			const detail = err instanceof Error ? err.message : String(err);
			console.warn(`[Verba] "which ffmpeg" lookup failed: ${detail}`);
		}

		return null;
	}
}
