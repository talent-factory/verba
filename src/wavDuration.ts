/**
 * WAV file duration utility.
 * Extracted as a standalone module so it can be tested outside the VS Code extension host.
 */

import * as fs from 'fs';

/**
 * Calculates the duration of a WAV file in seconds from its 44-byte PCM header.
 * Assumes a canonical WAV layout (no extra fmt data or metadata before the data chunk),
 * guaranteed by the ffmpeg arguments in recorder.ts (-f wav, no metadata flags).
 * If the recording format changes, this function must be updated accordingly.
 */
export function getWavDurationSec(wavPath: string): number {
	let fd: number | undefined;
	try {
		fd = fs.openSync(wavPath, 'r');
		const header = Buffer.alloc(44);
		fs.readSync(fd, header, 0, 44, 0);
		const byteRate = header.readUInt32LE(28);
		const dataSize = header.readUInt32LE(40);
		if (byteRate === 0) {
			console.warn('[Verba] WAV header has byteRate=0, cannot compute duration');
			return 0;
		}
		return dataSize / byteRate;
	} catch (err: unknown) {
		console.error('[Verba] Failed to read WAV duration — Whisper cost will NOT be tracked for this recording:', err);
		return 0;
	} finally {
		if (fd !== undefined) {
			try { fs.closeSync(fd); } catch (closeErr: unknown) {
				console.warn('[Verba] Failed to close WAV file descriptor:', closeErr);
			}
		}
	}
}
