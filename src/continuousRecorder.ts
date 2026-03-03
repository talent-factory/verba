/**
 * ContinuousRecorder — Silence detection parsing for ffmpeg silencedetect output.
 *
 * This module provides types and parsing utilities for continuous dictation mode.
 * ffmpeg's `-af silencedetect` audio filter emits silence events on stderr which
 * are parsed here to detect speech pauses during recording.
 */

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
