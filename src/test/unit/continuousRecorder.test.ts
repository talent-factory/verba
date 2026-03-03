import * as assert from 'assert';

import { parseSilenceEvent, SilenceEvent } from '../../continuousRecorder';

suite('parseSilenceEvent', () => {

	test('parses silence_start line', () => {
		const result = parseSilenceEvent('[silencedetect @ 0x7f8] silence_start: 3.504');
		assert.deepStrictEqual(result, { type: 'silence_start', time: 3.504 } as SilenceEvent);
	});

	test('parses silence_end line', () => {
		const result = parseSilenceEvent('[silencedetect @ 0x7f8] silence_end: 5.123 | silence_duration: 1.619');
		assert.deepStrictEqual(result, { type: 'silence_end', time: 5.123 } as SilenceEvent);
	});

	test('returns null for non-silence lines', () => {
		const result = parseSilenceEvent('size= 128kB time=00:00:08.00');
		assert.strictEqual(result, null);
	});

	test('returns null for empty string', () => {
		const result = parseSilenceEvent('');
		assert.strictEqual(result, null);
	});

	test('handles decimal precision variations', () => {
		// Single decimal place
		const r1 = parseSilenceEvent('[silencedetect @ 0x7f8] silence_start: 12.5');
		assert.deepStrictEqual(r1, { type: 'silence_start', time: 12.5 });

		// Zero value
		const r2 = parseSilenceEvent('[silencedetect @ 0x7f8] silence_start: 0.0');
		assert.deepStrictEqual(r2, { type: 'silence_start', time: 0.0 });

		// Three decimal places
		const r3 = parseSilenceEvent('[silencedetect @ 0x7f8] silence_end: 100.123 | silence_duration: 2.000');
		assert.deepStrictEqual(r3, { type: 'silence_end', time: 100.123 });
	});

	test('handles lines with extra whitespace', () => {
		const r1 = parseSilenceEvent('  [silencedetect @ 0x7f8] silence_start: 3.504  ');
		assert.deepStrictEqual(r1, { type: 'silence_start', time: 3.504 });

		const r2 = parseSilenceEvent('  [silencedetect @ 0x7f8] silence_end: 5.123 | silence_duration: 1.619  ');
		assert.deepStrictEqual(r2, { type: 'silence_end', time: 5.123 });
	});
});
