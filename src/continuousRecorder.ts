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
 * ContinuousRecorder manages a long-running ffmpeg recording process with
 * silence-based segment extraction.
 *
 * It extends EventEmitter and emits:
 *   - 'segment' (SegmentEvent) — when a speech segment is successfully extracted
 *   - 'error' (Error) — when segment extraction fails
 *
 * The class is constructed with the path to the continuous WAV file. The
 * `start()` and `stop()` methods will be added in a later task; for now this
 * class provides `extractSegment()` which spawns a second ffmpeg process to
 * copy a time-range from the continuous WAV into a separate segment file.
 */
export class ContinuousRecorder extends EventEmitter {
	private _outputPath: string;
	private _segmentCount: number = 0;
	private _isRecording: boolean = false;

	constructor(outputPath: string) {
		super();
		this._outputPath = outputPath;
	}

	get isRecording(): boolean {
		return this._isRecording;
	}

	get outputPath(): string {
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
}
