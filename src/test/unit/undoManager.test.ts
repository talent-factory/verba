import * as assert from 'assert';

import {
	computeEndPosition,
	computeInsertedRanges,
	recordDictation,
	clearLastDictation,
	getLastDictation,
} from '../../undoManager';

suite('undoManager', () => {
	teardown(() => {
		clearLastDictation();
	});

	// --- computeEndPosition ---

	suite('computeEndPosition', () => {
		test('single-line text at start of line', () => {
			const end = computeEndPosition(0, 0, 'hello');
			assert.deepStrictEqual(end, { line: 0, character: 5 });
		});

		test('single-line text at mid-line offset', () => {
			const end = computeEndPosition(3, 10, 'world');
			assert.deepStrictEqual(end, { line: 3, character: 15 });
		});

		test('multi-line text', () => {
			const end = computeEndPosition(2, 5, 'line1\nline2\nline3');
			assert.deepStrictEqual(end, { line: 4, character: 5 });
		});

		test('text ending with newline', () => {
			const end = computeEndPosition(0, 0, 'hello\n');
			assert.deepStrictEqual(end, { line: 1, character: 0 });
		});

		test('empty text', () => {
			const end = computeEndPosition(1, 5, '');
			assert.deepStrictEqual(end, { line: 1, character: 5 });
		});
	});

	// --- computeInsertedRanges ---

	suite('computeInsertedRanges', () => {
		test('single cursor insert', () => {
			const ranges = computeInsertedRanges(
				[{ startLine: 3, startCharacter: 10, endLine: 3, endCharacter: 10, isEmpty: true }],
				'hello',
			);
			assert.strictEqual(ranges.length, 1);
			assert.deepStrictEqual(ranges[0], {
				startLine: 3, startCharacter: 10, endLine: 3, endCharacter: 15,
			});
		});

		test('single cursor with multi-line text', () => {
			const ranges = computeInsertedRanges(
				[{ startLine: 1, startCharacter: 5, endLine: 1, endCharacter: 5, isEmpty: true }],
				'hello\nworld',
			);
			assert.strictEqual(ranges.length, 1);
			assert.deepStrictEqual(ranges[0], {
				startLine: 1, startCharacter: 5, endLine: 2, endCharacter: 5,
			});
		});

		test('selection replacement (single-line)', () => {
			const ranges = computeInsertedRanges(
				[{ startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 10, isEmpty: false }],
				'replaced',
			);
			assert.strictEqual(ranges.length, 1);
			assert.deepStrictEqual(ranges[0], {
				startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 8,
			});
		});

		test('multi-cursor on different lines', () => {
			const ranges = computeInsertedRanges(
				[
					{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 0, isEmpty: true },
					{ startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 0, isEmpty: true },
				],
				'AB',
			);
			assert.strictEqual(ranges.length, 2);
			// First cursor: no offset
			assert.deepStrictEqual(ranges[0], {
				startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 2,
			});
			// Second cursor: no offset (different line, single-line insert)
			assert.deepStrictEqual(ranges[1], {
				startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 2,
			});
		});

		test('multi-cursor on different lines with multi-line text', () => {
			const ranges = computeInsertedRanges(
				[
					{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 0, isEmpty: true },
					{ startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 0, isEmpty: true },
				],
				'A\nB',
			);
			assert.strictEqual(ranges.length, 2);
			// First insert: (1,0)-(2,1) — adds 1 line
			assert.deepStrictEqual(ranges[0], {
				startLine: 1, startCharacter: 0, endLine: 2, endCharacter: 1,
			});
			// Second insert: shifted by 1 line → (6,0)-(7,1)
			assert.deepStrictEqual(ranges[1], {
				startLine: 6, startCharacter: 0, endLine: 7, endCharacter: 1,
			});
		});

		test('multi-cursor on same line with single-line text', () => {
			const ranges = computeInsertedRanges(
				[
					{ startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 0, isEmpty: true },
					{ startLine: 2, startCharacter: 10, endLine: 2, endCharacter: 10, isEmpty: true },
				],
				'XX',
			);
			assert.strictEqual(ranges.length, 2);
			// First: (2,0)-(2,2)
			assert.deepStrictEqual(ranges[0], {
				startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 2,
			});
			// Second: shifted by 2 chars → (2,12)-(2,14)
			assert.deepStrictEqual(ranges[1], {
				startLine: 2, startCharacter: 12, endLine: 2, endCharacter: 14,
			});
		});
	});

	// --- recordDictation / getLastDictation / clearLastDictation ---

	suite('record management', () => {
		test('returns undefined when no dictation recorded', () => {
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('stores and retrieves a dictation record', () => {
			const record = {
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			};
			recordDictation(record);
			assert.deepStrictEqual(getLastDictation(), record);
		});

		test('new record replaces previous', () => {
			recordDictation({
				documentUri: 'file:///a.ts',
				insertedText: 'first',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			const second = {
				documentUri: 'file:///b.ts',
				insertedText: 'second',
				insertedRanges: [{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 6 }],
				originalTexts: [''],
			};
			recordDictation(second);
			assert.deepStrictEqual(getLastDictation(), second);
		});

		test('clearLastDictation removes the record', () => {
			recordDictation({
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			clearLastDictation();
			assert.strictEqual(getLastDictation(), undefined);
		});
	});
});
