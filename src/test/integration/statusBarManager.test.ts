import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { StatusBarManager } from '../../statusBarManager';

suite('StatusBarManager', () => {
	let manager: StatusBarManager;
	let spy: sinon.SinonSpy;

	setup(() => {
		spy = sinon.spy(vscode.window, 'createStatusBarItem');
		manager = new StatusBarManager();
	});

	teardown(() => {
		manager.dispose();
		sinon.restore();
	});

	test('creates left-aligned StatusBarItem with priority 100', () => {
		assert.ok(spy.calledOnce);
		assert.strictEqual(spy.firstCall.args[0], vscode.StatusBarAlignment.Left);
		assert.strictEqual(spy.firstCall.args[1], 100);
	});

	test('sets command to dictation.start', () => {
		const item = spy.firstCall.returnValue;
		assert.strictEqual(item.command, 'dictation.start');
	});

	test('initializes in idle state', () => {
		const item = spy.firstCall.returnValue;
		assert.strictEqual(item.text, '$(mic) Verba');
		assert.strictEqual(item.tooltip, 'Click to start dictation');
	});

	test('switches to recording state', () => {
		manager.setRecording();
		const item = spy.firstCall.returnValue;
		assert.strictEqual(item.text, '$(circle-filled) Recording...');
		assert.ok(item.backgroundColor instanceof vscode.ThemeColor);
		assert.strictEqual(item.tooltip, 'Click to stop dictation');
	});

	test('switches back to idle state', () => {
		manager.setRecording();
		manager.setIdle();
		const item = spy.firstCall.returnValue;
		assert.strictEqual(item.text, '$(mic) Verba');
		assert.strictEqual(item.backgroundColor, undefined);
		assert.strictEqual(item.tooltip, 'Click to start dictation');
	});
});
