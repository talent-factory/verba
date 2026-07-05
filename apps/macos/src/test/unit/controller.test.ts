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
			setState: sinon.stub(),
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

	test('happy path: cleans the transcript, pastes it, and keeps the window hidden', async () => {
		await dictate(controller);

		assert.strictEqual(deps.cleanup.process.calledOnce, true);
		assert.strictEqual(deps.cleanup.process.firstCall.args[0], 'raw transcript');
		assert.deepStrictEqual(deps.cleanup.process.firstCall.args[1], { detectedLanguage: 'en' });
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'cleaned text' }),
			true
		);
		assert.strictEqual(deps.notifier.info.calledWithMatch(/pasted/i), true);
		assert.strictEqual(deps.ui.showTranscript.called, false);
		assert.strictEqual(deps.ui.setPhase.calledWith('Idle.'), true);
	});

	test('cleanup failure falls back to pasting the raw transcript with a warning', async () => {
		deps.cleanup.process.rejects(new Error('Anthropic API key required for post-processing.'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.warn.calledWithMatch(/raw transcript/), true);
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'raw transcript' }),
			true
		);
		assert.strictEqual(deps.notifier.error.called, false);
	});

	test('missing Accessibility permission shows onboarding + transcript window, never pastes', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('has_accessibility_permission').resolves(false);

		await dictate(controller);

		assert.strictEqual(deps.ui.showAccessibilityOnboarding.calledOnce, true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('cleaned text'), true);
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', sinon.match.any),
			false
		);
	});

	test('paste failure falls back to showing the transcript in the window', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('paste_text', sinon.match.any)
			.rejects(new Error('Paste failed: could not create event source'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.error.calledWithMatch(/paste failed/i), true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('cleaned text'), true);
	});

	test('cleanup failure + missing Accessibility still surfaces the RAW transcript in the window', async () => {
		deps.cleanup.process.rejects(new Error('Anthropic API key required for post-processing.'));
		(deps.invoke as unknown as sinon.SinonStub).withArgs('has_accessibility_permission').resolves(false);

		await dictate(controller);

		assert.strictEqual(deps.notifier.warn.calledWithMatch(/raw transcript/), true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('raw transcript'), true);
	});

	test('cleanup failure + paste failure still surfaces the RAW transcript in the window', async () => {
		deps.cleanup.process.rejects(new Error('overloaded'));
		(deps.invoke as unknown as sinon.SinonStub).withArgs('paste_text', sinon.match.any)
			.rejects(new Error('Paste failed'));

		await dictate(controller);

		assert.strictEqual(deps.ui.showTranscript.calledWith('raw transcript'), true);
		assert.strictEqual(deps.notifier.error.calledWithMatch(/paste failed/i), true);
	});

	test('ignores a hotkey press while transcription is already in flight', async () => {
		// stop_capture never resolves → the controller stays in the transcribing
		// state; a third press must not start a new recording or re-enter the flow.
		let releaseStop: () => void = () => {};
		(deps.invoke as unknown as sinon.SinonStub).withArgs('stop_capture')
			.returns(new Promise<string>((resolve) => { releaseStop = () => resolve('/tmp/rec.wav'); }));

		await controller.handleHotkey(); // start recording
		const stop = controller.handleHotkey(); // stop → enters transcribing, awaits stop_capture
		await controller.handleHotkey(); // should be ignored (busy)

		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).withArgs('start_capture').callCount,
			1,
			'start_capture must only have been called once',
		);
		releaseStop();
		await stop;
	});

	test('emits setState across the dictation lifecycle', async () => {
		await dictate(controller);

		const states = (deps.ui.setState as sinon.SinonStub).getCalls().map((c) => c.args[0]);
		assert.deepStrictEqual(states, ['recording', 'transcribing', 'processing', 'idle']);
	});

	test('on a failing dictation, the last setState call is still idle', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('stop_capture').rejects(new Error('capture broke'));

		await dictate(controller);

		const states = (deps.ui.setState as sinon.SinonStub).getCalls().map((c) => c.args[0]);
		assert.strictEqual(states[states.length - 1], 'idle');
	});
});
