import * as assert from 'assert';
import * as sinon from 'sinon';

import { insertText } from '../../insertText';

suite('insertText', () => {
	teardown(() => {
		sinon.restore();
	});

	test('inserts text into active editor at cursor position', async () => {
		const insertStub = sinon.stub();
		const editStub = sinon.stub().callsFake((cb: Function) => {
			cb({ insert: insertStub });
			return Promise.resolve(true);
		});
		const cursorPosition = { line: 5, character: 10 };
		const fakeEditor = {
			selection: { active: cursorPosition },
			edit: editStub,
		};

		await insertText('hello world', fakeEditor as any, undefined, false);

		assert.ok(editStub.calledOnce);
		assert.ok(insertStub.calledOnce);
		assert.strictEqual(insertStub.firstCall.args[0], cursorPosition);
		assert.strictEqual(insertStub.firstCall.args[1], 'hello world');
	});

	test('sends text to active terminal when no editor', async () => {
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('hello world', undefined, fakeTerminal as any, false);

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
		const editStub = sinon.stub().resolves(false);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};

		await assert.rejects(
			() => insertText('hello', fakeEditor as any, undefined, false),
			/Failed to insert transcription/
		);
	});

	test('throws actionable message when editor.edit rejects', async () => {
		const editStub = sinon.stub().rejects(new Error('Editor disposed'));
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};

		await assert.rejects(
			() => insertText('hello', fakeEditor as any, undefined, false),
			/Failed to insert transcription.*Editor disposed/
		);
	});

	test('prefers terminal when preferTerminal is true and both are available', async () => {
		const editStub = sinon.stub().resolves(true);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('hello', fakeEditor as any, fakeTerminal as any, false, true);

		assert.ok(sendTextStub.calledOnce, 'terminal.sendText should be called');
		assert.ok(editStub.notCalled, 'editor.edit should not be called');
	});

	test('falls back to editor when preferTerminal is true but no terminal', async () => {
		const editStub = sinon.stub().resolves(true);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};

		await insertText('hello', fakeEditor as any, undefined, false, true);

		assert.ok(editStub.calledOnce, 'editor.edit should be called as fallback');
	});

	test('prefers editor over terminal when both are available', async () => {
		const editStub = sinon.stub().resolves(true);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('hello', fakeEditor as any, fakeTerminal as any, false);

		assert.ok(editStub.calledOnce, 'editor.edit should be called');
		assert.ok(sendTextStub.notCalled, 'terminal.sendText should not be called');
	});
});
