import * as assert from 'assert';
import * as sinon from 'sinon';

import { DictationController, type ControllerDeps } from '../../controller';

/** All-stub dependency set; individual tests override behavior as needed. */
export function createDeps() {
	const invoke = sinon.stub();
	invoke.withArgs('start_capture').resolves(undefined);
	invoke.withArgs('stop_capture').resolves('/tmp/rec.wav');
	invoke.withArgs('has_accessibility_permission').resolves(true);
	invoke.withArgs('paste_text', sinon.match.any).resolves(undefined);

	return {
		deepgram: { transcribe: sinon.stub().resolves({ text: 'raw transcript', detectedLanguage: 'en' }) },
		cleanup: { process: sinon.stub().resolves('cleaned text') },
		notifier: {
			init: sinon.stub().resolves(),
			info: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
		},
		store: { init: sinon.stub().resolves() },
		invoke: invoke as unknown as ControllerDeps['invoke'],
		ui: {
			setPhase: sinon.stub(),
			showTranscript: sinon.stub().resolves(),
			showAccessibilityOnboarding: sinon.stub().resolves(),
		},
	};
}

/** Presses the hotkey twice: start recording, then stop-and-transcribe. */
async function dictate(controller: DictationController): Promise<void> {
	await controller.handleHotkey();
	await controller.handleHotkey();
}

suite('DictationController', () => {
	let deps: ReturnType<typeof createDeps>;
	let controller: DictationController;

	setup(() => {
		deps = createDeps();
		controller = new DictationController(deps as unknown as ControllerDeps);
	});

	test('first hotkey press starts capture and sets the recording phase', async () => {
		await controller.handleHotkey();

		assert.strictEqual((deps.invoke as unknown as sinon.SinonStub).calledWith('start_capture'), true);
		assert.strictEqual(deps.ui.setPhase.calledWithMatch(/Recording/), true);
	});

	test('start_capture failure surfaces as an error notification', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('start_capture').rejects(new Error('no mic'));

		await controller.handleHotkey();

		assert.strictEqual(deps.notifier.error.calledWithMatch(/no mic/), true);
	});

	test('stop_capture failure surfaces as an error notification and resets to Idle', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('stop_capture').rejects(new Error('capture broke'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.error.calledWithMatch(/capture broke/), true);
		assert.strictEqual(deps.ui.setPhase.calledWith('Idle.'), true);
	});

	test('init initializes the store', async () => {
		await controller.init();

		assert.strictEqual(deps.store.init.calledOnce, true);
	});
});
