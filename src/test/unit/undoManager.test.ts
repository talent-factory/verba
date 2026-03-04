import * as assert from 'assert';

import {
	computeEndPosition,
	computeInsertedRanges,
	recordDictation,
	clearLastDictation,
	getLastDictation,
	executeUndo,
	DictationRecord,
	UndoDeps,
	UndoEditor,
	UndoResult,
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

		test('selection replacement (multi-line selection with single-line text)', () => {
			// Replace lines 2-4 (3 lines) with a single-line "collapsed"
			const ranges = computeInsertedRanges(
				[{ startLine: 2, startCharacter: 5, endLine: 4, endCharacter: 3, isEmpty: false }],
				'collapsed',
			);
			assert.strictEqual(ranges.length, 1);
			// Selection spans 2 lines (4-2=2), text is single-line (0 newlines)
			// Result: starts at (2,5), ends at (2, 5+9=14)
			assert.deepStrictEqual(ranges[0], {
				startLine: 2, startCharacter: 5, endLine: 2, endCharacter: 14,
			});
		});

		test('selection replacement (multi-line selection with multi-line text)', () => {
			// Replace lines 1-3 (3 lines) with 2-line text "A\nB"
			const ranges = computeInsertedRanges(
				[{ startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 10, isEmpty: false }],
				'A\nB',
			);
			assert.strictEqual(ranges.length, 1);
			// Selection spans 2 lines (3-1=2), text has 1 newline
			// Result: starts at (1,0), ends at (2,1)
			assert.deepStrictEqual(ranges[0], {
				startLine: 1, startCharacter: 0, endLine: 2, endCharacter: 1,
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

		test('empty selections array', () => {
			const ranges = computeInsertedRanges([], 'hello');
			assert.deepStrictEqual(ranges, []);
		});
	});

	// --- recordDictation / getLastDictation / clearLastDictation ---

	suite('record management', () => {
		test('returns undefined when no dictation recorded', () => {
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('stores and retrieves an editor dictation record', () => {
			const record: DictationRecord = {
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			};
			recordDictation(record);
			assert.deepStrictEqual(getLastDictation(), record);
		});

		test('stores and retrieves a terminal dictation record', () => {
			const record: DictationRecord = {
				type: 'terminal',
				insertedText: 'npm install',
				wasExecuted: false,
			};
			recordDictation(record);
			assert.deepStrictEqual(getLastDictation(), record);
		});

		test('stores terminal record with wasExecuted flag', () => {
			const record: DictationRecord = {
				type: 'terminal',
				insertedText: 'ls -la',
				wasExecuted: true,
			};
			recordDictation(record);
			const retrieved = getLastDictation();
			assert.strictEqual(retrieved?.type, 'terminal');
			assert.strictEqual(retrieved?.insertedText, 'ls -la');
			if (retrieved?.type === 'terminal') {
				assert.strictEqual(retrieved.wasExecuted, true);
			}
		});

		test('new record replaces previous', () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///a.ts',
				insertedText: 'first',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			const second: DictationRecord = {
				type: 'terminal',
				insertedText: 'second',
				wasExecuted: false,
			};
			recordDictation(second);
			assert.deepStrictEqual(getLastDictation(), second);
		});

		test('clearLastDictation removes the record', () => {
			recordDictation({
				type: 'terminal',
				insertedText: 'hello',
				wasExecuted: false,
			});
			clearLastDictation();
			assert.strictEqual(getLastDictation(), undefined);
		});
	});

	// --- executeUndo ---

	suite('executeUndo', () => {
		function makeDeps(overrides: Partial<UndoDeps> = {}): UndoDeps {
			return {
				getActiveTerminal: () => undefined,
				findEditorForUri: () => undefined,
				openDocument: () => Promise.reject(new Error('not implemented')),
				...overrides,
			};
		}

		function makeEditor(overrides: Partial<UndoEditor> = {}): UndoEditor {
			return {
				getTextInRange: () => '',
				applyEdits: () => Promise.resolve(true),
				...overrides,
			};
		}

		test('returns no-record when nothing is recorded', async () => {
			const result = await executeUndo(makeDeps());
			assert.strictEqual(result.status, 'no-record');
		});

		test('terminal undo with wasExecuted clears record and returns terminal-was-executed', async () => {
			recordDictation({ type: 'terminal', insertedText: 'ls', wasExecuted: true });
			const result = await executeUndo(makeDeps());
			assert.strictEqual(result.status, 'terminal-was-executed');
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('terminal undo with no active terminal clears record and returns terminal-no-terminal', async () => {
			recordDictation({ type: 'terminal', insertedText: 'hello', wasExecuted: false });
			const result = await executeUndo(makeDeps({ getActiveTerminal: () => undefined }));
			assert.strictEqual(result.status, 'terminal-no-terminal');
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('terminal undo sends backspace characters and clears record', async () => {
			recordDictation({ type: 'terminal', insertedText: 'abc', wasExecuted: false });
			let sentText = '';
			let sentAddNewline: boolean | undefined;
			const result = await executeUndo(makeDeps({
				getActiveTerminal: () => ({
					sendText: (text: string, addNewline: boolean) => {
						sentText = text;
						sentAddNewline = addNewline;
					},
				}),
			}));
			assert.strictEqual(result.status, 'terminal-undone');
			assert.strictEqual(sentText, '\x7F\x7F\x7F');
			assert.strictEqual(sentAddNewline, false);
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('editor undo finds visible editor and applies reverse edit', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			let appliedEdits: Array<{ startLine: number; startChar: number; endLine: number; endChar: number; newText: string }> = [];
			const result = await executeUndo(makeDeps({
				findEditorForUri: (uri) => uri === 'file:///test.ts'
					? makeEditor({
						getTextInRange: () => 'hello',
						applyEdits: (edits) => { appliedEdits = edits; return Promise.resolve(true); },
					})
					: undefined,
			}));
			assert.strictEqual(result.status, 'editor-undone');
			assert.strictEqual(appliedEdits.length, 1);
			assert.strictEqual(appliedEdits[0].newText, '');
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('editor undo opens document when not visible', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///other.ts',
				insertedText: 'text',
				insertedRanges: [{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 4 }],
				originalTexts: ['orig'],
			});
			let openedUri = '';
			const result = await executeUndo(makeDeps({
				findEditorForUri: () => undefined,
				openDocument: async (uri) => {
					openedUri = uri;
					return makeEditor({
						getTextInRange: () => 'text',
						applyEdits: () => Promise.resolve(true),
					});
				},
			}));
			assert.strictEqual(result.status, 'editor-undone');
			assert.strictEqual(openedUri, 'file:///other.ts');
		});

		test('editor undo returns editor-document-unavailable when document cannot be opened', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///deleted.ts',
				insertedText: 'text',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4 }],
				originalTexts: [''],
			});
			const result = await executeUndo(makeDeps({
				findEditorForUri: () => undefined,
				openDocument: () => Promise.reject(new Error('file not found')),
			}));
			assert.strictEqual(result.status, 'editor-document-unavailable');
			if (result.status === 'editor-document-unavailable') {
				assert.ok(result.reason.includes('file not found'));
			}
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('editor undo aborts when document text has changed', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			const result = await executeUndo(makeDeps({
				findEditorForUri: () => makeEditor({
					getTextInRange: () => 'changed',
				}),
			}));
			assert.strictEqual(result.status, 'editor-document-changed');
			assert.strictEqual(getLastDictation(), undefined);
		});

		test('editor undo returns editor-edit-failed when edit is rejected', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			const result = await executeUndo(makeDeps({
				findEditorForUri: () => makeEditor({
					getTextInRange: () => 'hello',
					applyEdits: () => Promise.resolve(false),
				}),
			}));
			assert.strictEqual(result.status, 'editor-edit-failed');
			assert.ok(getLastDictation() !== undefined, 'undo record should be preserved on transient failure');
		});

		test('editor undo processes multi-cursor ranges in reverse document order', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'X',
				insertedRanges: [
					{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 1 },
					{ startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 1 },
				],
				originalTexts: ['a', 'b'],
			});
			let appliedEdits: Array<{ startLine: number; newText: string }> = [];
			await executeUndo(makeDeps({
				findEditorForUri: () => makeEditor({
					getTextInRange: () => 'X',
					applyEdits: (edits) => {
						appliedEdits = edits.map(e => ({ startLine: e.startLine, newText: e.newText }));
						return Promise.resolve(true);
					},
				}),
			}));
			// Should be in reverse order: line 5 first, then line 1
			assert.strictEqual(appliedEdits[0].startLine, 5);
			assert.strictEqual(appliedEdits[0].newText, 'b');
			assert.strictEqual(appliedEdits[1].startLine, 1);
			assert.strictEqual(appliedEdits[1].newText, 'a');
		});

		test('editor undo restores original texts correctly', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'new',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 }],
				originalTexts: ['old'],
			});
			let appliedEdits: Array<{ newText: string }> = [];
			await executeUndo(makeDeps({
				findEditorForUri: () => makeEditor({
					getTextInRange: () => 'new',
					applyEdits: (edits) => {
						appliedEdits = edits;
						return Promise.resolve(true);
					},
				}),
			}));
			assert.strictEqual(appliedEdits[0].newText, 'old');
		});

		test('returns error status on unexpected exception', async () => {
			recordDictation({
				type: 'editor',
				documentUri: 'file:///test.ts',
				insertedText: 'hello',
				insertedRanges: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }],
				originalTexts: [''],
			});
			const result = await executeUndo(makeDeps({
				findEditorForUri: () => {
					throw new Error('unexpected crash');
				},
			}));
			assert.strictEqual(result.status, 'error');
			if (result.status === 'error') {
				assert.ok(result.message.includes('unexpected crash'));
			}
			assert.ok(getLastDictation() !== undefined, 'undo record should be preserved on unexpected errors');
		});
	});
});
