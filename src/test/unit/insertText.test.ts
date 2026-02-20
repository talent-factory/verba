import * as assert from 'assert';
import * as sinon from 'sinon';

import { insertText } from '../../insertText';

suite('insertText', () => {
	teardown(() => {
		sinon.restore();
	});

	test('inserts text into active editor when available', async () => {
		const editStub = sinon.stub().resolves(true);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};

		await insertText('hello world', fakeEditor as any, undefined, false);

		assert.ok(editStub.calledOnce);
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
