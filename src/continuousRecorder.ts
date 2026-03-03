/**
 * ContinuousRecorder — Continuous dictation with silence-based segmentation.
 *
 * Records audio via ffmpeg with the `-af silencedetect` audio filter, parses
 * silence events from stderr in real-time, and extracts speech segments
 * automatically when pauses are detected.
 *
 * Lifecycle: start() -> (silence events trigger extractSegment) -> stop() / dispose()
 */

import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { findFfmpeg, getFfmpegInstallHint, getPlatformAudioConfig } from './recorder';

export interface SilenceEvent {
	type: 'silence_start' | 'silence_end';
	time: number;
}

export interface SegmentEvent {
	segmentPath: string;
	segmentIndex: number;
	startTime: number;
	endTime: number;
}

/**
 * Parses a single line of ffmpeg stderr output for silencedetect events.
 *
 * Recognizes two formats:
 *   [silencedetect @ 0x...] silence_start: <time>
 *   [silencedetect @ 0x...] silence_end: <time> | silence_duration: <dur>
 *
 * @param line A single line from ffmpeg stderr
 * @returns A SilenceEvent if the line contains a silence event, null otherwise
 */
export function parseSilenceEvent(line: string): SilenceEvent | null {
	const startMatch = line.match(/silence_start:\s*([\d.]+)/);
	if (startMatch) {
		return { type: 'silence_start', time: parseFloat(startMatch[1]) };
	}

	const endMatch = line.match(/silence_end:\s*([\d.]+)/);
	if (endMatch) {
		return { type: 'silence_end', time: parseFloat(endMatch[1]) };
	}

	return null;
}

/**
 * Continuous audio recorder with silence-based automatic segmentation.
 *
 * Records audio via ffmpeg with the silencedetect audio filter. When a speech
 * pause is detected (silence_end event), the segment of speech before the pause
 * is automatically extracted into a separate WAV file and emitted as a
 * 'segment' event.
 *
 * Events:
 *   'segment' (SegmentEvent) — emitted when a speech segment is extracted
 *   'error'   (Error)        — emitted on non-fatal errors (e.g. segment extraction failure)
 *   'stopped' ()             — emitted after stop() completes and final segment is extracted
 */
export class ContinuousRecorder extends EventEmitter {
	private process: ChildProcess | null = null;
	private _outputPath: string;
	private _segmentCount: number = 0;
	private _isRecording: boolean = false;
	private lastSegmentEnd: number = 0;
	private lastSilenceStart: number | null = null;
	private silenceThreshold: number;
	private silenceLevel: number;
	private stderrBuffer: string = '';

	/**
	 * @param outputPath - Explicit path for the continuous recording WAV file.
	 *                     If not provided, a timestamped path in the temp directory is generated on start().
	 * @param silenceThreshold - Minimum silence duration in seconds to trigger segmentation (default: 1.5)
	 * @param silenceLevel - Silence detection level in dB (default: -30)
	 */
	constructor(outputPath?: string, silenceThreshold: number = 1.5, silenceLevel: number = -30) {
		super();
		this._outputPath = outputPath || '';
		this.silenceThreshold = silenceThreshold;
		this.silenceLevel = silenceLevel;
	}

	/** Whether a recording is currently in progress. */
	get isRecording(): boolean {
		return this._isRecording;
	}

	/** Absolute path to the continuous recording WAV file. */
	get outputPath(): string {
		return this._outputPath;
	}

	/**
	 * Starts continuous recording with silence detection.
	 *
	 * Spawns ffmpeg with the silencedetect audio filter. Parses stderr in real-time
	 * for silence events. When silence_end is detected, extracts the preceding speech
	 * segment automatically.
	 *
	 * @param preferredDevice - Platform-specific audio device name, or undefined for system default.
	 * @throws If ffmpeg is not found, the device is unavailable, or a recording is already active.
	 */
	async start(preferredDevice?: string): Promise<void> {
		if (this._isRecording) {
			throw new Error('Recording already in progress');
		}

		const ffmpegPath = findFfmpeg();
		if (!ffmpegPath) {
			throw new Error(`ffmpeg not found. ${getFfmpegInstallHint()}`);
		}

		const { inputFormat, inputDevice } = getPlatformAudioConfig(ffmpegPath, preferredDevice);

		// Generate output path if not set via constructor
		if (!this._outputPath) {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			this._outputPath = path.join(os.tmpdir(), `verba-continuous-${timestamp}.wav`);
		}

		// Reset state for new recording session
		this._segmentCount = 0;
		this.lastSegmentEnd = 0;
		this.lastSilenceStart = null;
		this.stderrBuffer = '';

		this.process = spawn(ffmpegPath, [
			'-f', inputFormat,
			'-i', inputDevice,
			'-af', `silencedetect=n=${this.silenceLevel}dB:d=${this.silenceThreshold}`,
			'-ar', '16000',
			'-ac', '1',
			'-acodec', 'pcm_s16le',
			'-y',
			this._outputPath,
		], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		// Parse stderr for silence events in real-time
		if (this.process.stderr) {
			this.process.stderr.on('data', (data: Buffer) => {
				this.stderrBuffer += data.toString();
				const lines = this.stderrBuffer.split('\n');
				// Keep the last incomplete line in the buffer
				this.stderrBuffer = lines.pop() || '';

				for (const line of lines) {
					const event = parseSilenceEvent(line);
					if (!event) { continue; }

					if (event.type === 'silence_start') {
						this.lastSilenceStart = event.time;
					} else if (event.type === 'silence_end') {
						if (this.lastSilenceStart !== null) {
							// Extract segment from lastSegmentEnd to lastSilenceStart
							// (the speech before the silence)
							const segStart = this.lastSegmentEnd;
							const segEnd = this.lastSilenceStart;
							this.lastSegmentEnd = event.time;
							this.extractSegment(segStart, segEnd);
						}
					}
				}
			});
		}

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const safeResolve = () => {
				if (!settled) { settled = true; resolve(); }
			};
			const safeReject = (err: Error) => {
				if (!settled) { settled = true; reject(err); }
			};

			// Heuristic: if ffmpeg hasn't crashed within 500ms, treat it as started.
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

			this.process!.on('close', (code) => {
				if (!this._isRecording) {
					clearTimeout(timeout);
					this.cleanup();
					safeReject(new Error(
						code === 1
							? 'Microphone access denied. Check System Settings > Privacy > Microphone.'
							: `ffmpeg exited unexpectedly with code ${code}`
					));
				}
			});
		});
	}

	/**
	 * Stops the continuous recording and extracts the final segment.
	 *
	 * Gracefully stops ffmpeg (sends 'q' to stdin, SIGKILL fallback after 3s),
	 * extracts the final speech segment, and emits the 'stopped' event.
	 *
	 * @throws If no recording is in progress.
	 * @returns The path to the continuous recording WAV file.
	 */
	async stop(): Promise<string> {
		if (!this._isRecording || !this.process) {
			throw new Error('No recording in progress');
		}

		const proc = this.process;

		await new Promise<void>((resolve, reject) => {
			const killTimeout = setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process already exited
				}
			}, 3000);

			const ultimateTimeout = setTimeout(() => {
				this.cleanup();
				reject(new Error(
					'Failed to stop recording: ffmpeg did not exit within 5 seconds. '
					+ `The recording file may be incomplete: ${this._outputPath}`
				));
			}, 5000);

			proc.removeAllListeners('close');
			proc.on('close', () => {
				clearTimeout(killTimeout);
				clearTimeout(ultimateTimeout);
				this._isRecording = false;
				this.process = null;
				resolve();
			});

			// Send 'q' to stdin for graceful shutdown (correct WAV headers)
			const stdin = proc.stdin as NodeJS.WritableStream | null;
			if (stdin && !(stdin as any).destroyed) {
				(stdin as any).write('q', (err?: Error | null) => {
					if (err) {
						console.warn(
							`[Verba] Graceful ffmpeg shutdown failed (${err.message}), forcing kill.`
						);
						try {
							proc.kill('SIGKILL');
						} catch {
							// Process already exited
						}
					}
				});
			} else {
				console.warn('[Verba] ffmpeg stdin unavailable, forcing kill.');
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process already exited
				}
			}
		});

		// Extract final segment (from lastSegmentEnd to end of recording).
		// Use a large endTime — ffmpeg clamps to actual duration.
		// If no silence was ever detected (lastSegmentEnd === 0), entire recording is one segment.
		const startTime = this.lastSegmentEnd;
		const endTime = 999999;
		await this.extractSegment(startTime, endTime);

		this.emit('stopped');

		return this._outputPath;
	}

	/**
	 * Extracts a time-range from the continuous WAV file into a separate
	 * segment file. The extraction spawns a second ffmpeg process that copies
	 * PCM data (very fast, ~50ms).
	 *
	 * On success, emits a 'segment' event with the SegmentEvent payload.
	 * On failure, emits an 'error' event. The returned promise always resolves
	 * (errors are communicated via events, never via rejection).
	 *
	 * @param startTime Start time in seconds within the continuous recording
	 * @param endTime End time in seconds within the continuous recording
	 */
	async extractSegment(startTime: number, endTime: number): Promise<void> {
		const ffmpegPath = findFfmpeg();
		if (!ffmpegPath) {
			this.emit('error', new Error('ffmpeg not found — cannot extract segment'));
			return;
		}

		const segmentIndex = this._segmentCount++;
		const segmentPath = this._outputPath.replace(/\.wav$/, `-seg-${segmentIndex}.wav`);

		return new Promise<void>((resolve) => {
			const proc = spawn(ffmpegPath, [
				'-i', this._outputPath,
				'-ss', String(startTime),
				'-to', String(endTime),
				'-ar', '16000',
				'-ac', '1',
				'-acodec', 'pcm_s16le',
				'-y',
				segmentPath,
			]);

			proc.on('close', (code: number | null) => {
				if (code === 0) {
					const event: SegmentEvent = {
						segmentPath,
						segmentIndex,
						startTime,
						endTime,
					};
					this.emit('segment', event);
				} else {
					this.emit('error', new Error(
						`Segment extraction failed with exit code ${code}`
					));
				}
				resolve();
			});

			proc.on('error', (err: Error) => {
				this.emit('error', err);
				resolve();
			});
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

	private cleanup(): void {
		this._isRecording = false;
		this.process = null;
	}
}
