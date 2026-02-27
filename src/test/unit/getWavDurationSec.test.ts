import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { getWavDurationSec } from '../../wavDuration';

/**
 * Creates a minimal valid WAV file header (44 bytes) with the given parameters.
 * Layout: RIFF header (12) + fmt chunk (24) + data chunk header (8) = 44 bytes.
 */
function createWavHeader(sampleRate: number, bitsPerSample: number, channels: number, dataSize: number): Buffer {
	const byteRate = sampleRate * channels * (bitsPerSample / 8);
	const blockAlign = channels * (bitsPerSample / 8);
	const header = Buffer.alloc(44);

	// RIFF header
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + dataSize, 4); // file size - 8
	header.write('WAVE', 8);

	// fmt chunk
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16); // fmt chunk size
	header.writeUInt16LE(1, 20); // PCM format
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);

	// data chunk
	header.write('data', 36);
	header.writeUInt32LE(dataSize, 40);

	return header;
}

suite('getWavDurationSec', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verba-wav-test-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('calculates correct duration for 16-bit 16kHz mono WAV (typical Whisper output)', () => {
		// 5 seconds of 16kHz 16-bit mono: byteRate = 32000, dataSize = 160000
		const dataSize = 5 * 16000 * 2; // 5 sec * 16kHz * 2 bytes
		const header = createWavHeader(16000, 16, 1, dataSize);
		const wavPath = path.join(tmpDir, 'test-16k.wav');
		fs.writeFileSync(wavPath, header);

		const duration = getWavDurationSec(wavPath);
		assert.strictEqual(duration, 5);
	});

	test('calculates correct duration for 16-bit 44.1kHz stereo WAV', () => {
		// 3 seconds of 44.1kHz 16-bit stereo: byteRate = 176400, dataSize = 529200
		const dataSize = 3 * 44100 * 2 * 2; // 3 sec * 44.1kHz * 2 channels * 2 bytes
		const header = createWavHeader(44100, 16, 2, dataSize);
		const wavPath = path.join(tmpDir, 'test-44k.wav');
		fs.writeFileSync(wavPath, header);

		const duration = getWavDurationSec(wavPath);
		assert.strictEqual(duration, 3);
	});

	test('returns 0 for non-existent file', () => {
		const duration = getWavDurationSec(path.join(tmpDir, 'does-not-exist.wav'));
		assert.strictEqual(duration, 0);
	});

	test('returns 0 for file shorter than 44 bytes', () => {
		const wavPath = path.join(tmpDir, 'short.wav');
		fs.writeFileSync(wavPath, Buffer.alloc(10));

		const duration = getWavDurationSec(wavPath);
		assert.strictEqual(duration, 0);
	});

	test('returns 0 when byteRate is zero', () => {
		const header = createWavHeader(16000, 16, 1, 32000);
		// Zero out byteRate at offset 28
		header.writeUInt32LE(0, 28);
		const wavPath = path.join(tmpDir, 'zero-byterate.wav');
		fs.writeFileSync(wavPath, header);

		const duration = getWavDurationSec(wavPath);
		assert.strictEqual(duration, 0);
	});

	test('handles fractional durations correctly', () => {
		// 2.5 seconds of 16kHz 16-bit mono
		const dataSize = Math.round(2.5 * 16000 * 2);
		const header = createWavHeader(16000, 16, 1, dataSize);
		const wavPath = path.join(tmpDir, 'fractional.wav');
		fs.writeFileSync(wavPath, header);

		const duration = getWavDurationSec(wavPath);
		assert.ok(Math.abs(duration - 2.5) < 0.001, `Expected ~2.5 but got ${duration}`);
	});
});
