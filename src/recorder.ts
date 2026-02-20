import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Records microphone audio to a WAV file using ffmpeg as a child process.
 *
 * Platform: macOS (avfoundation), Linux (PulseAudio), Windows (DirectShow).
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

		const ffmpegPath = this.findFfmpeg();
		if (!ffmpegPath) {
			throw new Error(`ffmpeg not found. ${this.getFfmpegInstallHint()}`);
		}

		const { inputFormat, inputDevice } = this.getPlatformAudioConfig();

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		this._outputPath = path.join(os.tmpdir(), `verba-recording-${timestamp}.wav`);

		this.process = spawn(ffmpegPath, [
			'-f', inputFormat,
			'-i', inputDevice,
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

	private getPlatformAudioConfig(): { inputFormat: string; inputDevice: string } {
		switch (process.platform) {
			case 'darwin':
				return { inputFormat: 'avfoundation', inputDevice: ':default' };
			case 'linux':
				return { inputFormat: 'pulse', inputDevice: 'default' };
			case 'win32':
				return { inputFormat: 'dshow', inputDevice: this.detectWindowsAudioDevice() };
			default:
				throw new Error(
					`Unsupported platform: ${process.platform}. Verba supports macOS, Linux, and Windows.`
				);
		}
	}

	private detectWindowsAudioDevice(): string {
		let stderr = '';
		try {
			execSync('ffmpeg -list_devices true -f dshow -i dummy', {
				encoding: 'utf-8',
				timeout: 10000,
			});
		} catch (err: unknown) {
			if (err && typeof err === 'object' && 'stderr' in err) {
				stderr = String((err as { stderr: unknown }).stderr);
			}
		}

		const lines = stderr.split('\n');
		let inAudioSection = false;

		for (const line of lines) {
			if (line.includes('DirectShow audio devices')) {
				inAudioSection = true;
				continue;
			}
			if (inAudioSection) {
				const match = line.match(/"([^"]+)"/);
				if (match) {
					return `audio=${match[1]}`;
				}
			}
		}

		throw new Error(
			'No audio input device found. Check that a microphone is connected and recognized by Windows.'
		);
	}

	private cleanup(): void {
		this._isRecording = false;
		this.process = null;
	}

	private getFfmpegCandidatePaths(): string[] {
		switch (process.platform) {
			case 'darwin':
				return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
			case 'linux':
				return ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
			case 'win32':
				return [];
			default:
				return [];
		}
	}

	private getFfmpegInstallHint(): string {
		switch (process.platform) {
			case 'darwin':
				return 'Install it via: brew install ffmpeg';
			case 'linux':
				return 'Install it via: sudo apt install ffmpeg (Debian/Ubuntu) or sudo dnf install ffmpeg (Fedora)';
			case 'win32':
				return 'Download from https://ffmpeg.org/download.html and add to PATH';
			default:
				return 'Install ffmpeg and ensure it is available in PATH';
		}
	}

	// Check common platform-specific paths first (avoids execSync overhead and
	// PATH issues in VS Code's sandboxed environment), then fall back to
	// which(1) (Unix) or where (Windows).
	private findFfmpeg(): string | null {
		const candidates = this.getFfmpegCandidatePaths();

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}

		const lookupCommand = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';

		try {
			const result = execSync(lookupCommand, {
				encoding: 'utf-8',
				timeout: 5000,
			}).trim();
			if (result) {
				// 'where' on Windows may return multiple lines; take the first match
				return result.split(/\r?\n/)[0];
			}
		} catch (err: unknown) {
			// which/where exits non-zero when ffmpeg is not in PATH
			const detail = err instanceof Error ? err.message : String(err);
			console.warn(`[Verba] "${lookupCommand}" lookup failed: ${detail}`);
		}

		return null;
	}
}
