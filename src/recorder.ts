import { ChildProcess, spawn, execSync, spawnSync } from 'child_process';
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

	/** Whether a recording is currently in progress. */
	get isRecording(): boolean {
		return this._isRecording;
	}

	/** Absolute path to the current (or most recent) WAV recording file. */
	get outputPath(): string {
		return this._outputPath;
	}

	/**
	 * Starts recording audio to a temporary WAV file.
	 * @param preferredDevice - Platform-specific audio device name, or undefined for system default.
	 * @throws If ffmpeg is not found, the device is unavailable, or a recording is already active.
	 */
	async start(preferredDevice?: string): Promise<void> {
		if (this._isRecording) {
			throw new Error('Recording already in progress');
		}

		const ffmpegPath = this.findFfmpeg();
		if (!ffmpegPath) {
			throw new Error(`ffmpeg not found. ${this.getFfmpegInstallHint()}`);
		}

		const { inputFormat, inputDevice } = this.getPlatformAudioConfig(ffmpegPath, preferredDevice);

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

	/**
	 * Stops the active recording and returns the path to the WAV file.
	 * Uses a three-stage shutdown: graceful `q` via stdin, SIGKILL after 3 s, hard timeout at 5 s.
	 * @throws If no recording is in progress or the file is empty/missing.
	 */
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

	/** Kills any active ffmpeg process and removes the temporary recording file. */
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

	private getPlatformAudioConfig(ffmpegPath: string, preferredDevice?: string): { inputFormat: string; inputDevice: string } {
		switch (process.platform) {
			case 'darwin':
				return {
					inputFormat: 'avfoundation',
					inputDevice: preferredDevice ? `:${preferredDevice}` : ':default',
				};
			case 'linux':
				return {
					inputFormat: 'pulse',
					inputDevice: preferredDevice || 'default',
				};
			case 'win32': {
				const device = preferredDevice
					? `audio=${preferredDevice}`
					: this.detectWindowsAudioDevice(ffmpegPath);
				console.log(`[Verba] Using audio device: ${device}`);
				return { inputFormat: 'dshow', inputDevice: device };
			}
			default:
				throw new Error(
					`Unsupported platform: ${process.platform}. Verba supports macOS, Linux, and Windows.`
				);
		}
	}

	private detectWindowsAudioDevice(ffmpegPath: string): string {
		const devices = this.listAudioDevicesFromFfmpeg(ffmpegPath);
		if (devices.length > 0) {
			return `audio=${devices[0]}`;
		}

		// Fallback: query Windows audio endpoints via PowerShell
		const psDevice = this.detectWindowsAudioDevicePowerShell();
		if (psDevice) {
			console.log(`[Verba] Found audio device via PowerShell: ${psDevice}`);
			return psDevice;
		}

		throw new Error(
			'No audio input device found. Check that a microphone is connected and recognized by Windows.'
		);
	}

	/** Lists available audio input devices for the current platform. */
	listAudioDevices(): string[] {
		const ffmpegPath = this.findFfmpeg();
		if (!ffmpegPath) {
			return [];
		}
		switch (process.platform) {
			case 'darwin':
				return this.listMacOSAudioDevices(ffmpegPath);
			case 'linux':
				return this.listLinuxAudioDevices();
			case 'win32':
				return this.listAudioDevicesFromFfmpeg(ffmpegPath);
			default:
				return [];
		}
	}

	private listAudioDevicesFromFfmpeg(ffmpegPath: string): string[] {
		const result = spawnSync(ffmpegPath, [
			'-list_devices', 'true', '-f', 'dshow', '-i', 'dummy',
		], {
			encoding: 'utf-8',
			timeout: 10000,
			windowsHide: true,
		});

		if (result.error) {
			console.warn(`[Verba] ffmpeg list_devices failed: ${result.error.message}`);
			return [];
		}

		const stderr = result.stderr || '';
		if (!stderr) {
			console.warn('[Verba] ffmpeg list_devices produced no stderr output');
			return [];
		}

		const lines = stderr.split('\n');
		const devices: string[] = [];

		// ffmpeg v8+ lists devices as: "DeviceName" (audio)
		// Older versions use a section header: "DirectShow audio devices"
		// Support both formats.
		let inAudioSection = false;

		for (const line of lines) {
			// New format (ffmpeg v8+): "DeviceName" (audio)
			const inlineMatch = line.match(/"([^"]+)"\s+\(audio\)/);
			if (inlineMatch) {
				devices.push(inlineMatch[1]);
				continue;
			}

			// Legacy format: section header followed by device names
			if (line.includes('DirectShow audio devices')) {
				inAudioSection = true;
				continue;
			}
			if (inAudioSection) {
				if (line.includes('Alternative name')) { continue; }
				if (line.includes('DirectShow video') || line.includes('DirectShow ')) {
					inAudioSection = false;
					continue;
				}
				const match = line.match(/"([^"]+)"/);
				if (match) {
					devices.push(match[1]);
				}
			}
		}

		if (devices.length === 0) {
			console.warn(`[Verba] ffmpeg found no audio devices in output (${stderr.length} bytes, ${lines.length} lines)`);
		}

		return devices;
	}

	private listMacOSAudioDevices(ffmpegPath: string): string[] {
		const result = spawnSync(ffmpegPath, [
			'-f', 'avfoundation', '-list_devices', 'true', '-i', '',
		], {
			encoding: 'utf-8',
			timeout: 10000,
		});

		if (result.error) {
			console.warn(`[Verba] ffmpeg list_devices failed: ${result.error.message}`);
			return [];
		}

		const stderr = result.stderr || '';
		const lines = stderr.split('\n');
		const devices: string[] = [];
		let inAudioSection = false;

		for (const line of lines) {
			if (line.includes('AVFoundation audio devices')) {
				inAudioSection = true;
				continue;
			}
			if (inAudioSection) {
				const match = line.match(/\[\d+\]\s+(.+)/);
				if (match) {
					devices.push(match[1].trim());
				} else if (line.includes('indev')) {
					// Skip ffmpeg metadata lines like "[AVFoundation indev @ 0x...]"
					continue;
				} else {
					break;
				}
			}
		}

		if (devices.length === 0) {
			console.warn(`[Verba] ffmpeg found no audio devices in avfoundation output (${stderr.length} bytes, ${lines.length} lines)`);
		}

		return devices;
	}

	private listLinuxAudioDevices(): string[] {
		const result = spawnSync('pactl', ['list', 'sources', 'short'], {
			encoding: 'utf-8',
			timeout: 10000,
		});

		if (result.error) {
			console.warn(`[Verba] pactl failed: ${result.error.message}`);
			return [];
		}

		if (result.status !== 0) {
			const stderr = (result.stderr || '').trim();
			console.warn(`[Verba] pactl exited with status ${result.status}${stderr ? ': ' + stderr : ''}`);
			return [];
		}

		const stdout = (result.stdout || '').trim();
		if (!stdout) {
			console.warn('[Verba] pactl returned no audio sources');
			return [];
		}

		// pactl list sources short: "ID\tNAME\tMODULE\tFORMAT\tSTATE"
		const devices = stdout.split('\n')
			.map(line => line.split('\t')[1])
			.filter((name): name is string => !!name);

		if (devices.length === 0) {
			console.warn(`[Verba] pactl returned ${stdout.split('\n').length} lines but no parseable audio sources`);
		}

		return devices;
	}

	private detectWindowsAudioDevicePowerShell(): string | null {
		const result = spawnSync('powershell.exe', [
			'-NoProfile', '-NonInteractive', '-Command',
			'Get-CimInstance Win32_SoundDevice | Where-Object { $_.StatusInfo -eq 3 -or $_.Status -eq "OK" } | Select-Object -First 1 -ExpandProperty Name',
		], {
			encoding: 'utf-8',
			timeout: 10000,
			windowsHide: true,
		});

		const name = (result.stdout || '').trim();
		if (!name) {
			return null;
		}

		// Win32_SoundDevice gives the driver name, not the DirectShow device name.
		// DirectShow names typically follow "Mikrofon (<DriverName>)" or similar.
		// Try both the raw name and common patterns with ffmpeg to see which works.
		return `audio=${name}`;
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
			case 'win32': {
				const paths = [
					'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
					path.join(os.homedir(), 'scoop', 'shims', 'ffmpeg.exe'),
					'C:\\ffmpeg\\bin\\ffmpeg.exe',
				];
				const programFiles = process.env['ProgramFiles'];
				if (programFiles) {
					paths.push(path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'));
				}
				const localAppData = process.env['LOCALAPPDATA'];
				if (localAppData) {
					paths.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
				}
				return paths;
			}
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

	// Check common platform-specific paths first (avoids shell overhead and
	// PATH issues in VS Code's sandboxed environment), then fall back to
	// which(1) (Unix) or where (Windows) via spawnSync.
	private findFfmpeg(): string | null {
		const candidates = this.getFfmpegCandidatePaths();

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}

		if (process.platform === 'win32') {
			const result = spawnSync('where', ['ffmpeg'], {
				encoding: 'utf-8',
				timeout: 5000,
				windowsHide: true,
			});
			const stdout = (result.stdout || '').trim();
			if (stdout) {
				return stdout.split(/\r?\n/)[0];
			}
		} else {
			try {
				const result = execSync('which ffmpeg', {
					encoding: 'utf-8',
					timeout: 5000,
				}).trim();
				if (result) {
					return result;
				}
			} catch (err: unknown) {
				const detail = err instanceof Error ? err.message : String(err);
				console.warn(`[Verba] "which ffmpeg" lookup failed: ${detail}`);
			}
		}

		return null;
	}
}
