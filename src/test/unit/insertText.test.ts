import * as assert from 'assert';
import * as sinon from 'sinon';

import { insertText } from '../../insertText';

/** Creates a fake selection with isEmpty derived from start/end equality. */
function sel(
	startLine: number, startChar: number,
	endLine: number, endChar: number,
) {
	const start = { line: startLine, character: startChar };
	const end = { line: endLine, character: endChar };
	return {
		active: end,
		start,
		end,
		isEmpty: startLine === endLine && startChar === endChar,
	};
}

/** Creates a fake editor with the given selections. */
function fakeEditor(selections: ReturnType<typeof sel>[], editResult: boolean | Error = true) {
	const editStub = sinon.stub().callsFake((cb: Function) => {
		if (editResult instanceof Error) {
			return Promise.reject(editResult);
		}
		const insertStub = sinon.stub();
		const replaceStub = sinon.stub();
		cb({ insert: insertStub, replace: replaceStub });
		// Store stubs on the editor for assertion access
		(editor as any)._lastInsertStub = insertStub;
		(editor as any)._lastReplaceStub = replaceStub;
		return Promise.resolve(editResult);
	});

	const editor = {
		selection: selections[0],
		selections,
		edit: editStub,
	};
	return editor;
}

suite('insertText', () => {
	teardown(() => {
		sinon.restore();
	});

	// --- Existing behaviour (single cursor, no selection) ---

	test('inserts text into active editor at cursor position', async () => {
		const cursor = sel(5, 10, 5, 10);
		const editor = fakeEditor([cursor]);

		const result = await insertText('hello world', editor as any, undefined, false);

		assert.strictEqual(result.target, 'editor');
		assert.ok(editor.edit.calledOnce);
		const insertStub = (editor as any)._lastInsertStub;
		assert.ok(insertStub.calledOnce);
		assert.strictEqual(insertStub.firstCall.args[0], cursor.active);
		assert.strictEqual(insertStub.firstCall.args[1], 'hello world');
	});

	test('sends text to active terminal when no editor', async () => {
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		const result = await insertText('hello world', undefined, fakeTerminal as any, false);

		assert.strictEqual(result.target, 'terminal');
		assert.ok(sendTextStub.calledOnce);
		assert.deepStrictEqual(sendTextStub.firstCall.args, ['hello world', false]);
	});

	test('sends text with addNewline=true when executeCommand is true', async () => {
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('ls -la', undefined, fakeTerminal as any, true);

		assert.deepStrictEqual(sendTextStub.firstCall.args, ['ls -la', true]);
	});

	test('throws when neither editor nor terminal is available', async () => {
		await assert.rejects(
			() => insertText('hello', undefined, undefined, false),
			/No active editor or terminal/
		);
	});

	test('throws when editor.edit returns false', async () => {
		const editor = fakeEditor([sel(0, 0, 0, 0)], false);

		await assert.rejects(
			() => insertText('hello', editor as any, undefined, false),
			/Failed to insert transcription/
		);
	});

	test('throws actionable message when editor.edit rejects', async () => {
		const editor = fakeEditor([sel(0, 0, 0, 0)], new Error('Editor disposed'));

		await assert.rejects(
			() => insertText('hello', editor as any, undefined, false),
			/Failed to insert transcription.*Editor disposed/
		);
	});

	test('prefers terminal when preferTerminal is true and both are available', async () => {
		const editor = fakeEditor([sel(0, 0, 0, 0)]);
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		const result = await insertText('hello', editor as any, fakeTerminal as any, false, true);

		assert.strictEqual(result.target, 'terminal');
		assert.ok(sendTextStub.calledOnce, 'terminal.sendText should be called');
		assert.ok(editor.edit.notCalled, 'editor.edit should not be called');
	});

	test('falls back to editor when preferTerminal is true but no terminal', async () => {
		const editor = fakeEditor([sel(0, 0, 0, 0)]);

		await insertText('hello', editor as any, undefined, false, true);

		assert.ok(editor.edit.calledOnce, 'editor.edit should be called as fallback');
	});

	test('prefers editor over terminal when both are available', async () => {
		const editor = fakeEditor([sel(0, 0, 0, 0)]);
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('hello', editor as any, fakeTerminal as any, false);

		assert.ok(editor.edit.calledOnce, 'editor.edit should be called');
		assert.ok(sendTextStub.notCalled, 'terminal.sendText should not be called');
	});

	// --- Multi-cursor support ---

	test('inserts text at all cursor positions with multi-cursor', async () => {
		const cursors = [sel(1, 5, 1, 5), sel(3, 10, 3, 10), sel(5, 0, 5, 0)];
		const editor = fakeEditor(cursors);

		await insertText('inserted', editor as any, undefined, false);

		assert.ok(editor.edit.calledOnce);
		const insertStub = (editor as any)._lastInsertStub;
		assert.strictEqual(insertStub.callCount, 3, 'should insert at all 3 cursor positions');

		// Should be called in reverse document order (line 5, 3, 1)
		assert.deepStrictEqual(insertStub.getCall(0).args[0], cursors[2].active);
		assert.deepStrictEqual(insertStub.getCall(1).args[0], cursors[1].active);
		assert.deepStrictEqual(insertStub.getCall(2).args[0], cursors[0].active);
	});

	// --- Selection replacement ---

	test('inserts at multiple cursors on the same line in reverse character order', async () => {
		const cursors = [
			sel(2, 5, 2, 5),   // col 5
			sel(2, 20, 2, 20), // col 20
			sel(2, 0, 2, 0),   // col 0
		];
		const editor = fakeEditor(cursors);

		await insertText('X', editor as any, undefined, false);

		const insertStub = (editor as any)._lastInsertStub;
		assert.strictEqual(insertStub.callCount, 3);
		// Reverse character order: col 20, col 5, col 0
		assert.deepStrictEqual(insertStub.getCall(0).args[0], cursors[1].active); // col 20
		assert.deepStrictEqual(insertStub.getCall(1).args[0], cursors[0].active); // col 5
		assert.deepStrictEqual(insertStub.getCall(2).args[0], cursors[2].active); // col 0
	});

	test('replaces selected text with dictated text', async () => {
		const selection = sel(2, 0, 2, 15); // non-empty selection
		const editor = fakeEditor([selection]);

		await insertText('replacement', editor as any, undefined, false);

		assert.ok(editor.edit.calledOnce);
		const replaceStub = (editor as any)._lastReplaceStub;
		assert.strictEqual(replaceStub.callCount, 1, 'should replace the selection');
		const range = replaceStub.firstCall.args[0];
		assert.deepStrictEqual(range.start, selection.start);
		assert.deepStrictEqual(range.end, selection.end);
		assert.strictEqual(replaceStub.firstCall.args[1], 'replacement');
	});

	test('replaces multiple selections in reverse order', async () => {
		const selections = [
			sel(1, 0, 1, 5),   // line 1, chars 0-5
			sel(5, 3, 5, 10),  // line 5, chars 3-10
			sel(3, 0, 3, 8),   // line 3, chars 0-8
		];
		const editor = fakeEditor(selections);

		await insertText('new', editor as any, undefined, false);

		const replaceStub = (editor as any)._lastReplaceStub;
		assert.strictEqual(replaceStub.callCount, 3, 'should replace all 3 selections');

		// Reverse order: line 5, line 3, line 1
		assert.deepStrictEqual(replaceStub.getCall(0).args[0].start, selections[1].start);
		assert.deepStrictEqual(replaceStub.getCall(1).args[0].start, selections[2].start);
		assert.deepStrictEqual(replaceStub.getCall(2).args[0].start, selections[0].start);
	});

	test('handles mixed cursors and selections per-selection', async () => {
		const selections = [
			sel(1, 0, 1, 0),   // empty cursor
			sel(3, 0, 3, 10),  // non-empty selection
		];
		const editor = fakeEditor(selections);

		await insertText('text', editor as any, undefined, false);

		const replaceStub = (editor as any)._lastReplaceStub;
		const insertStub = (editor as any)._lastInsertStub;
		// Non-empty selection should use replace, empty cursor should use insert
		assert.strictEqual(replaceStub.callCount, 1, 'non-empty selection should use replace');
		assert.strictEqual(insertStub.callCount, 1, 'empty cursor should use insert');
	});
});
