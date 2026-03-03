import * as assert from 'assert';
import * as sinon from 'sinon';
import * as Module from 'module';

// --- vscode mock (must be registered before importing StatusBarManager) ---

const mockStatusBarItem = {
	text: '',
	tooltip: '' as string | undefined,
	backgroundColor: undefined as any,
	command: undefined as string | undefined,
	show: sinon.stub(),
	dispose: sinon.stub(),
};

class MockThemeColor {
	constructor(public id: string) {}
}

const vscodeStub = {
	window: {
		createStatusBarItem: sinon.stub().returns(mockStatusBarItem),
	},
	StatusBarAlignment: { Left: 1, Right: 2 },
	ThemeColor: MockThemeColor,
};

// Register the mock before any import of statusBarManager
const originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
	request: string,
	parent: any,
	isMain: boolean,
	options: any,
) {
	if (request === 'vscode') {
		return 'vscode'; // Return the name so require uses our cached version
	}
	return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.cache['vscode'] = {
	id: 'vscode',
	filename: 'vscode',
	loaded: true,
	exports: vscodeStub,
} as any;

// Now import StatusBarManager (it will pick up our vscode mock)
import { StatusBarManager } from '../../statusBarManager';

suite('StatusBarManager (unit)', () => {
	let manager: StatusBarManager;

	setup(() => {
		// Reset the mock item state before each test
		mockStatusBarItem.text = '';
		mockStatusBarItem.tooltip = undefined;
		mockStatusBarItem.backgroundColor = undefined;
		mockStatusBarItem.command = undefined;
		mockStatusBarItem.show.resetHistory();
		mockStatusBarItem.dispose.resetHistory();
		vscodeStub.window.createStatusBarItem.resetHistory();
		vscodeStub.window.createStatusBarItem.returns(mockStatusBarItem);

		manager = new StatusBarManager();
	});

	teardown(() => {
		manager.dispose();
		sinon.restore();
	});

	suite('setRecordingContinuous', () => {
		test('with no args shows continuous recording text', () => {
			manager.setRecordingContinuous();

			assert.strictEqual(
				mockStatusBarItem.text,
				'$(circle-filled) Continuous Recording...',
			);
		});

		test('with segments > 0 shows segment count', () => {
			manager.setRecordingContinuous(3);

			assert.strictEqual(
				mockStatusBarItem.text,
				'$(circle-filled) Recording (3 segments inserted)',
			);
		});

		test('with 0 segments shows initial continuous state', () => {
			manager.setRecordingContinuous(0);

			assert.strictEqual(
				mockStatusBarItem.text,
				'$(circle-filled) Continuous Recording...',
			);
		});

		test('with processingSegment=true shows processing indicator', () => {
			manager.setRecordingContinuous(2, true);

			assert.strictEqual(
				mockStatusBarItem.text,
				'$(circle-filled) Recording | Processing seg 3...',
			);
		});

		test('always sets red background (errorBackground)', () => {
			manager.setRecordingContinuous();
			assert.ok(mockStatusBarItem.backgroundColor instanceof MockThemeColor);
			assert.strictEqual(
				(mockStatusBarItem.backgroundColor as MockThemeColor).id,
				'statusBarItem.errorBackground',
			);

			// Also when showing segments
			manager.setRecordingContinuous(5);
			assert.ok(mockStatusBarItem.backgroundColor instanceof MockThemeColor);
			assert.strictEqual(
				(mockStatusBarItem.backgroundColor as MockThemeColor).id,
				'statusBarItem.errorBackground',
			);

			// Also when processing
			manager.setRecordingContinuous(1, true);
			assert.ok(mockStatusBarItem.backgroundColor instanceof MockThemeColor);
			assert.strictEqual(
				(mockStatusBarItem.backgroundColor as MockThemeColor).id,
				'statusBarItem.errorBackground',
			);
		});

		test('sets tooltip to stop continuous dictation', () => {
			manager.setRecordingContinuous();
			assert.strictEqual(
				mockStatusBarItem.tooltip,
				'Click to stop continuous dictation',
			);

			manager.setRecordingContinuous(3);
			assert.strictEqual(
				mockStatusBarItem.tooltip,
				'Click to stop continuous dictation',
			);

			manager.setRecordingContinuous(2, true);
			assert.strictEqual(
				mockStatusBarItem.tooltip,
				'Click to stop continuous dictation',
			);
		});
	});
});
