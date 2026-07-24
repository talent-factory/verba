import * as assert from 'assert';
import { validateTranscript } from '../../transcription';

suite('validateTranscript', () => {
	test('returns the text unchanged for real speech', () => {
		assert.strictEqual(validateTranscript('hello world'), 'hello world');
	});

	test('keeps text that merely contains dots or numbers', () => {
		assert.strictEqual(validateTranscript('Version 1.2.3 released.'), 'Version 1.2.3 released.');
	});

	test('throws "no speech" on empty input', () => {
		assert.throws(() => validateTranscript(''), /No speech detected/);
	});

	test('throws "no speech" on whitespace-only input', () => {
		assert.throws(() => validateTranscript('   \n\t '), /No speech detected/);
	});

	test('throws "only silence" on a dots/ellipsis-only transcript', () => {
		assert.throws(() => validateTranscript('… . ..'), /only silence/);
	});
});
