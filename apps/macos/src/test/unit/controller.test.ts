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

	test('stop_capture that stalls (never settles) recovers to idle within the timeout', async () => {
		// Models the native capture thread hanging on cpal/CoreAudio stream teardown:
		// `invoke('stop_capture')` neither resolves nor rejects. Without the timeout this
		// froze the flow in "Transcribing…" forever with no error and no logs.
		(deps.invoke as unknown as sinon.SinonStub)
			.withArgs('stop_capture')
			.returns(new Promise<string>(() => {}));
		const stalled = new DictationController({
			...(deps as unknown as ControllerDeps),
			stopCaptureTimeoutMs: 10,
		});

		await dictate(stalled);

		assert.strictEqual(deps.notifier.error.calledWithMatch(/timed out/), true);
		assert.strictEqual(deps.ui.setPhase.calledWith('Idle.'), true);
		// Transcription/cleanup/paste must never run when the recording can't be finalized.
		assert.strictEqual(deps.deepgram.transcribe.called, false);
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', sinon.match.any),
			false
		);
		// The flow must settle back to idle, never leaving the state stuck.
		const states = (deps.ui.setState as sinon.SinonStub).getCalls().map((c) => c.args[0]);
		assert.strictEqual(states[states.length - 1], 'idle');
	});

	test('stop_capture that RESOLVES after the timeout is consumed (no unhandledRejection)', async () => {
		// The abandoned recording finalizes late — after we've already timed out and
		// reset to idle. The late path must be swallowed: no transcription, no paste,
		// no unhandledRejection.
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			(deps.invoke as unknown as sinon.SinonStub)
				.withArgs('stop_capture')
				.returns(new Promise<string>((resolve) => setTimeout(() => resolve('/tmp/late.wav'), 30)));
			const stalled = new DictationController({
				...(deps as unknown as ControllerDeps),
				stopCaptureTimeoutMs: 10,
			});

			await dictate(stalled);
			await new Promise((r) => setTimeout(r, 40));

			assert.strictEqual(deps.deepgram.transcribe.called, false);
			assert.strictEqual(
				(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', sinon.match.any),
				false
			);
			assert.deepStrictEqual(unhandled, [], 'late stop_capture resolution must not escape');
		} finally {
			process.removeListener('unhandledRejection', onUnhandled);
		}
	});

	test('stop_capture that REJECTS after the timeout is consumed (no unhandledRejection)', async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			(deps.invoke as unknown as sinon.SinonStub)
				.withArgs('stop_capture')
				.returns(new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error('late teardown error')), 30)));
			const stalled = new DictationController({
				...(deps as unknown as ControllerDeps),
				stopCaptureTimeoutMs: 10,
			});

			await dictate(stalled);
			await new Promise((r) => setTimeout(r, 40));

			assert.strictEqual(deps.notifier.error.calledWithMatch(/timed out/), true);
			assert.deepStrictEqual(unhandled, [], 'late stop_capture rejection must not escape');
		} finally {
			process.removeListener('unhandledRejection', onUnhandled);
		}
	});

	test('cleanup that RESOLVES after the timeout is ignored (raw transcript already used)', async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			deps.cleanup.process = sinon.stub().returns(
				new Promise<string>((resolve) => setTimeout(() => resolve('cleaned LATE'), 30)),
			);
			const stalled = new DictationController({
				...(deps as unknown as ControllerDeps),
				cleanupTimeoutMs: 10,
			});

			await dictate(stalled);
			await new Promise((r) => setTimeout(r, 40));

			// Fell back to the raw transcript on timeout; the late cleaned value must not
			// be pasted, and must not surface as an unhandledRejection.
			assert.strictEqual(
				(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'raw transcript' }),
				true
			);
			assert.strictEqual(
				(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'cleaned LATE' }),
				false
			);
			assert.deepStrictEqual(unhandled, [], 'late cleanup resolution must not escape');
		} finally {
			process.removeListener('unhandledRejection', onUnhandled);
		}
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

	test('cleanup that stalls (never settles) still pastes the raw transcript within the timeout', async () => {
		// Models a hung Anthropic request: the promise neither resolves nor rejects.
		// Without the timeout this would freeze the flow in "Processing…" forever;
		// the fallback only ever fired on a thrown error, never on a stall.
		let captured: AbortSignal | undefined;
		deps.cleanup.process = sinon.stub().callsFake(
			(_input: string, _ctx: unknown, signal?: AbortSignal) => {
				captured = signal;
				return new Promise<string>(() => {});
			},
		);
		const stalled = new DictationController({
			...(deps as unknown as ControllerDeps),
			cleanupTimeoutMs: 10,
		});

		await dictate(stalled);

		assert.strictEqual(deps.notifier.warn.calledWithMatch(/timed out/), true);
		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'raw transcript' }),
			true
		);
		assert.strictEqual(deps.notifier.error.called, false);
		// The timeout aborts the underlying request so no API cost is wasted on a
		// result we've already discarded.
		assert.strictEqual(captured?.aborted, true, 'cleanup signal must be aborted on timeout');
		// The flow must still settle back to idle, never leaving the state stuck.
		const states = (deps.ui.setState as sinon.SinonStub).getCalls().map((c) => c.args[0]);
		assert.strictEqual(states[states.length - 1], 'idle');
	});

	test('cleanup that rejects AFTER the timeout does not leak an unhandledRejection', async () => {
		// The abandoned request settles late (e.g. the abort or a delayed API
		// error surfaces after we've already fallen back). It must be consumed,
		// not surface as an unhandledRejection that could crash/log-spam the host.
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			deps.cleanup.process = sinon.stub().returns(
				new Promise<string>((_resolve, reject) =>
					setTimeout(() => reject(new Error('late API failure')), 30),
				),
			);
			const stalled = new DictationController({
				...(deps as unknown as ControllerDeps),
				cleanupTimeoutMs: 10,
			});

			await dictate(stalled);
			// Give the late rejection time to fire against the already-elapsed timeout.
			await new Promise((resolve) => setTimeout(resolve, 40));

			assert.strictEqual(
				(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'raw transcript' }),
				true
			);
			assert.deepStrictEqual(unhandled, [], 'no unhandledRejection may escape the timeout wrapper');
		} finally {
			process.removeListener('unhandledRejection', onUnhandled);
		}
	});

	test('cleanup that resolves just under the timeout still uses the CLEANED text', async () => {
		// A slow-but-valid cleanup (resolves before the deadline) must not be
		// mistaken for a stall: the cleaned text wins, not the raw fallback.
		deps.cleanup.process = sinon.stub().returns(
			new Promise<string>((resolve) => setTimeout(() => resolve('cleaned text'), 5)),
		);
		const slow = new DictationController({
			...(deps as unknown as ControllerDeps),
			cleanupTimeoutMs: 50,
		});

		await dictate(slow);

		assert.strictEqual(
			(deps.invoke as unknown as sinon.SinonStub).calledWith('paste_text', { text: 'cleaned text' }),
			true
		);
		assert.strictEqual(deps.notifier.warn.called, false);
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
