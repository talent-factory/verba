/**
 * ContinuousRecorder — Continuous dictation with Deepgram WebSocket streaming.
 *
 * Records audio via ffmpeg (raw PCM to stdout) and pipes it to Deepgram's
 * real-time speech-to-text WebSocket API. Deepgram handles VAD (Voice Activity
 * Detection) and utterance segmentation internally — no silencedetect filter,
 * no segment extraction, no WAV files.
 *
 * Lifecycle: start() -> (Deepgram transcript events) -> stop() / dispose()
 */

import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import { findFfmpeg, getFfmpegInstallHint, getPlatformAudioConfig } from './recorder';

// Lazy-load @deepgram/sdk (same pattern as other SDKs in this project)
function getDeepgramSdk(): typeof import('@deepgram/sdk') {
	return require('@deepgram/sdk');
}

export interface TranscriptEvent {
	text: string;
	isFinal: boolean;
	utteranceIndex: number;
}

/**
 * Continuous audio recorder with Deepgram WebSocket streaming.
 *
 * Records audio via ffmpeg (raw PCM piped to stdout) and sends it to Deepgram's
 * real-time transcription API via WebSocket. Deepgram's built-in VAD and
 * utterance detection handle pause segmentation — no ffmpeg silencedetect,
 * no WAV segment extraction, no Whisper hallucination filtering needed.
 *
 * Events:
 *   'transcript' (TranscriptEvent) — emitted when a complete utterance is ready
 *   'interim'    (string)          — emitted for partial/interim transcription results
 *   'error'      (Error)           — emitted on non-fatal errors
 *   'stopped'    ()                — emitted after stop() completes
 */
export class ContinuousRecorder extends EventEmitter {
	private ffmpegProcess: ChildProcess | null = null;
	private connection: any = null;  // LiveClient from @deepgram/sdk
	private _isRecording: boolean = false;
	private _stopping: boolean = false;
	private _utteranceCount: number = 0;
	private pendingTranscript: string = '';
	private lastEmittedText: string = '';
	private sendFailureCount: number = 0;
	private static readonly MAX_SEND_FAILURES = 10;

	constructor(private deepgramApiKey: string) {
		super();
		// Prevent unhandled 'error' events during startup (before extension registers listeners)
		this.on('error', () => {});
	}

	/** Whether a recording is currently in progress. */
	get isRecording(): boolean { return this._isRecording; }

	/** Number of utterances emitted so far. */
	get utteranceCount(): number { return this._utteranceCount; }

	/**
	 * Starts continuous recording with Deepgram WebSocket streaming.
	 *
	 * 1. Opens a Deepgram live transcription WebSocket connection
	 * 2. Spawns ffmpeg to capture audio as raw PCM (s16le, 16kHz, mono)
	 * 3. Pipes ffmpeg stdout directly to the Deepgram WebSocket
	 *
	 * @param preferredDevice - Platform-specific audio device name, or undefined for system default.
	 * @throws If ffmpeg is not found, Deepgram connection fails, or a recording is already active.
	 */
	async start(preferredDevice?: string): Promise<void> {
		if (this._isRecording) {
			throw new Error('Continuous recording already in progress');
		}

		const ffmpegPath = findFfmpeg();
		if (!ffmpegPath) {
			throw new Error(`ffmpeg not found. ${getFfmpegInstallHint()}`);
		}

		const { inputFormat, inputDevice } = getPlatformAudioConfig(ffmpegPath, preferredDevice);

		// Create Deepgram live connection
		const { createClient, LiveTranscriptionEvents } = getDeepgramSdk();
		const client = createClient(this.deepgramApiKey);
		this.connection = client.listen.live({
			model: 'nova-3',
			language: 'multi',
			smart_format: true,
			interim_results: true,
			utterance_end_ms: 1500,
			vad_events: true,
			endpointing: 300,
			encoding: 'linear16',
			sample_rate: 16000,
			channels: 1,
		});

		// Set up Deepgram event handlers
		this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
			if (this._stopping) { return; }
			const transcript = data.channel?.alternatives?.[0]?.transcript || '';
			if (!transcript) { return; }
			if (data.is_final) {
				this.pendingTranscript += (this.pendingTranscript ? ' ' : '') + transcript;
			} else {
				this.emit('interim', transcript);
			}
		});

		this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
			if (this._stopping) { return; }
			if (this.pendingTranscript && this.pendingTranscript !== this.lastEmittedText) {
				this.lastEmittedText = this.pendingTranscript;
				const idx = this._utteranceCount++;
				this.emit('transcript', {
					text: this.pendingTranscript,
					isFinal: true,
					utteranceIndex: idx,
				} as TranscriptEvent);
			}
			this.pendingTranscript = '';
		});

		this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
			console.error('[Verba] Deepgram error:', error);
			this.emit('error', error instanceof Error ? error : new Error(String(error)));
		});

		this.connection.on(LiveTranscriptionEvents.Close, () => {
			// Only report unexpected closes — during stop(), ffmpegProcess is already null
			if (this._isRecording && !this._stopping && this.ffmpegProcess) {
				console.error('[Verba] Deepgram WebSocket closed unexpectedly');
				this.emit('error', new Error('Deepgram connection closed unexpectedly. Transcription may be incomplete.'));
			}
		});

		// Wait for Deepgram connection to open
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Deepgram connection timed out (10s)')), 10000);
			this.connection!.on(LiveTranscriptionEvents.Open, () => {
				clearTimeout(timeout);
				resolve();
			});
			this.connection!.on(LiveTranscriptionEvents.Error, (err: any) => {
				clearTimeout(timeout);
				reject(new Error(`Deepgram connection failed: ${err}`));
			});
		});

		// Start ffmpeg (audio capture only — pipe raw PCM to stdout)
		this.ffmpegProcess = spawn(ffmpegPath, [
			'-f', inputFormat,
			'-i', inputDevice,
			'-ar', '16000',
			'-ac', '1',
			'-f', 's16le',
			'pipe:1',
		], { stdio: ['pipe', 'pipe', 'pipe'] });

		// Log ffmpeg stderr for diagnostics
		this.ffmpegProcess.stderr?.on('data', (data: Buffer) => {
			console.warn('[Verba] ffmpeg stderr:', data.toString().trim());
		});

		// Pipe ffmpeg stdout to Deepgram
		this.ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
			try {
				if (this.connection) {
					this.connection.send(chunk);
					this.sendFailureCount = 0;
				}
			} catch (e) {
				this.sendFailureCount++;
				if (this.sendFailureCount <= 3) {
					console.error(`[Verba] Deepgram send failed (${this.sendFailureCount}):`, e);
				}
				if (this.sendFailureCount >= ContinuousRecorder.MAX_SEND_FAILURES) {
					this.emit('error', new Error('Deepgram connection broken (multiple send failures). Stopping recording.'));
					this.dispose();
					this.emit('stopped');
				}
			}
		});

		this.ffmpegProcess.on('close', (code) => {
			if (this._isRecording) {
				this._isRecording = false;
				this.emit('error', new Error(
					`Recording stopped unexpectedly (ffmpeg exited with code ${code})`
				));
				this.emit('stopped');
			}
		});

		// Wait for ffmpeg to start (500ms heuristic)
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
					this._isRecording = true;
					this._utteranceCount = 0;
					this._stopping = false;
					this.pendingTranscript = '';
					this.lastEmittedText = '';
					this.sendFailureCount = 0;
					resolve();
				} else {
					reject(new Error('ffmpeg terminated during startup'));
				}
			}, 500);
			this.ffmpegProcess!.on('error', (err) => {
				clearTimeout(timeout);
				reject(new Error(`ffmpeg failed to start: ${err.message}`));
			});
		});
	}

	/**
	 * Stops the continuous recording and flushes any pending transcript.
	 *
	 * Gracefully stops ffmpeg (sends 'q' to stdin, SIGKILL fallback after 3s),
	 * flushes the last pending utterance, closes the Deepgram connection,
	 * and emits the 'stopped' event.
	 *
	 * @throws If no recording is in progress.
	 */
	async stop(): Promise<void> {
		if (!this._isRecording) {
			throw new Error('No continuous recording in progress');
		}

		// Step 1: Stop ffmpeg (stop sending audio to Deepgram)
		if (this.ffmpegProcess) {
			const proc = this.ffmpegProcess;
			this.ffmpegProcess = null;
			await new Promise<void>((resolve) => {
				const killTimer = setTimeout(() => {
					try { proc.kill('SIGKILL'); } catch (e) { console.error('[Verba] ffmpeg SIGKILL failed:', e); }
				}, 3000);
				// Force-resolve after 5s to prevent hanging forever
				const maxTimer = setTimeout(() => {
					console.error('[Verba] ffmpeg did not exit within 5s, force-continuing');
					clearTimeout(killTimer);
					resolve();
				}, 5000);
				proc.removeAllListeners('close');
				proc.on('close', () => {
					clearTimeout(killTimer);
					clearTimeout(maxTimer);
					resolve();
				});
				if (proc.stdin && !(proc.stdin as any).destroyed) {
					(proc.stdin as any).write('q', (err?: Error) => {
						if (err) {
							try { proc.kill('SIGKILL'); } catch (e) { console.error('[Verba] ffmpeg SIGKILL failed:', e); }
						}
					});
				} else {
					try { proc.kill('SIGKILL'); } catch (e) { console.error('[Verba] ffmpeg SIGKILL failed:', e); }
				}
			});
		}

		// Step 2: Let Deepgram finish processing buffered audio.
		// Signal end-of-audio, then wait for final UtteranceEnd or timeout.
		if (this.connection) {
			try {
				if (typeof this.connection.finish === 'function') {
					this.connection.finish();
				}
			} catch (e) { console.error('[Verba] Deepgram finish() failed:', e); }

			const { LiveTranscriptionEvents } = getDeepgramSdk();
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(resolve, 2000);
				this.connection?.on(LiveTranscriptionEvents.UtteranceEnd, () => {
					clearTimeout(timeout);
					resolve();
				});
			});
		}

		// Step 3: Block further Deepgram events and flush remaining text
		this._stopping = true;
		if (this.pendingTranscript) {
			const idx = this._utteranceCount++;
			this.emit('transcript', {
				text: this.pendingTranscript,
				isFinal: true,
				utteranceIndex: idx,
			} as TranscriptEvent);
			this.pendingTranscript = '';
		}

		// Step 4: Close Deepgram connection
		if (this.connection) {
			try { this.connection.requestClose(); } catch (e) { console.error('[Verba] Deepgram requestClose failed:', e); }
			this.connection = null;
		}

		this._isRecording = false;
		this.emit('stopped');
	}

	/** Kills any active ffmpeg process and closes the Deepgram connection. */
	dispose(): void {
		if (this.ffmpegProcess) {
			try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) { console.error('[Verba] ffmpeg SIGKILL failed:', e); }
			this.ffmpegProcess = null;
		}
		if (this.connection) {
			try { this.connection.requestClose(); } catch (e) { console.error('[Verba] Deepgram requestClose failed:', e); }
			this.connection = null;
		}
		this._isRecording = false;
	}
}
