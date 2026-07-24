import * as assert from 'assert';
import * as sinon from 'sinon';

import type { DetectedSurface } from '@verba/core';

import { DictationController, type ControllerDeps } from '../../controller';
import type { DeliveryPorts, Intent } from '../../delivery';

/** All-stub dependency set; individual tests override behavior as needed. */
export function createDeps() {
	const invoke = sinon.stub();
	invoke.withArgs('start_capture').resolves(undefined);
	invoke.withArgs('stop_capture').resolves('/tmp/rec.wav');
	invoke.withArgs('has_accessibility_permission').resolves(true);

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
		// Delivery routing (Task 5). Default surface is generic → the `paste` port
		// is the delivery target, mirroring the old blind `paste_text` behavior.
		delivery: {
			detectSurface: sinon.stub().resolves({ class: 'generic' } as DetectedSurface),
			herdrSend: sinon.stub().resolves(),
			paste: sinon.stub().resolves(),
			pressEnter: sinon.stub().resolves(),
		},
		ui: {
			setPhase: sinon.stub(),
			showTranscript: sinon.stub().resolves(),
			showAccessibilityOnboarding: sinon.stub().resolves(),
			setState: sinon.stub(),
		},
	};
}

/** Builds a controller from {@link createDeps}, applying per-test overrides. */
function makeController(overrides: Partial<ControllerDeps> = {}): DictationController {
	const deps = { ...createDeps(), ...overrides };
	return new DictationController(deps as unknown as ControllerDeps);
}

/** A macrotask flush, so queued async work (e.g. a fired arm timer) settles. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * {@link DeliveryPorts} that report a focused agent pane, so `deliver()` routes
 * through `herdrSend`; `onSend` observes the delivered text and resolved intent.
 */
function fakeAgentPorts(onSend: (text: string, intent: Intent) => void): DeliveryPorts {
	return {
		detectSurface: async (): Promise<DetectedSurface> => ({ class: 'agent', paneId: 'pane-1' }),
		herdrSend: async (_paneId: string, text: string, submit: boolean): Promise<void> => {
			onSend(text, submit ? 'submit' : 'insert');
		},
		paste: async (): Promise<void> => {},
		pressEnter: async (): Promise<void> => {},
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
		// Transcription/cleanup/delivery must never run when the recording can't be finalized.
		assert.strictEqual(deps.deepgram.transcribe.called, false);
		assert.strictEqual(deps.delivery.paste.called, false);
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
			assert.strictEqual(deps.delivery.paste.called, false);
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
			// be delivered, and must not surface as an unhandledRejection.
			assert.strictEqual(deps.delivery.paste.calledWith('raw transcript'), true);
			assert.strictEqual(deps.delivery.paste.calledWith('cleaned LATE'), false);
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
		assert.strictEqual(deps.delivery.paste.calledWith('cleaned text'), true);
		assert.strictEqual(deps.notifier.info.calledWithMatch(/pasted/i), true);
		assert.strictEqual(deps.ui.showTranscript.called, false);
		assert.strictEqual(deps.ui.setPhase.calledWith('Idle.'), true);
	});

	test('cleanup failure falls back to pasting the raw transcript with a warning', async () => {
		deps.cleanup.process.rejects(new Error('Anthropic API key required for post-processing.'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.warn.calledWithMatch(/raw transcript/), true);
		assert.strictEqual(deps.delivery.paste.calledWith('raw transcript'), true);
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
		assert.strictEqual(deps.delivery.paste.calledWith('raw transcript'), true);
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

			assert.strictEqual(deps.delivery.paste.calledWith('raw transcript'), true);
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

		assert.strictEqual(deps.delivery.paste.calledWith('cleaned text'), true);
		assert.strictEqual(deps.notifier.warn.called, false);
	});

	test('missing Accessibility permission shows onboarding + transcript window, never pastes', async () => {
		(deps.invoke as unknown as sinon.SinonStub).withArgs('has_accessibility_permission').resolves(false);

		await dictate(controller);

		assert.strictEqual(deps.ui.showAccessibilityOnboarding.calledOnce, true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('cleaned text'), true);
		assert.strictEqual(deps.delivery.paste.called, false);
	});

	test('delivery failure falls back to showing the transcript in the window', async () => {
		deps.delivery.paste.rejects(new Error('Paste failed: could not create event source'));

		await dictate(controller);

		assert.strictEqual(deps.notifier.error.calledWithMatch(/delivery failed/i), true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('cleaned text'), true);
	});

	test('cleanup failure + missing Accessibility still surfaces the RAW transcript in the window', async () => {
		deps.cleanup.process.rejects(new Error('Anthropic API key required for post-processing.'));
		(deps.invoke as unknown as sinon.SinonStub).withArgs('has_accessibility_permission').resolves(false);

		await dictate(controller);

		assert.strictEqual(deps.notifier.warn.calledWithMatch(/raw transcript/), true);
		assert.strictEqual(deps.ui.showTranscript.calledWith('raw transcript'), true);
	});

	test('cleanup failure + delivery failure still surfaces the RAW transcript in the window', async () => {
		deps.cleanup.process.rejects(new Error('overloaded'));
		deps.delivery.paste.rejects(new Error('Paste failed'));

		await dictate(controller);

		assert.strictEqual(deps.ui.showTranscript.calledWith('raw transcript'), true);
		assert.strictEqual(deps.notifier.error.calledWithMatch(/delivery failed/i), true);
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

	test('short tap (release before threshold) never records', async () => {
		let armed: (() => void) | null = null;
		const started: string[] = [];
		const invoke = (async (cmd: string) => {
			started.push(cmd);
			return undefined;
		}) as unknown as ControllerDeps['invoke'];
		const c = makeController({
			schedule: (fn) => {
				armed = fn;
				return () => {
					armed = null;
				};
			},
			invoke,
		});

		await c.handlePttDown('insert');
		await c.handlePttUp(); // released before the arm timer fired

		assert.ok(armed === null, 'arm timer was cancelled');
		assert.ok(!started.includes('start_capture'), 'no recording started');
	});

	test('hold past threshold records, release delivers with the held intent', async () => {
		let armed: (() => void) | null = null;
		const delivered: Array<{ text: string; intent: string }> = [];
		const c = makeController({
			schedule: (fn) => {
				armed = fn;
				return () => {};
			},
			delivery: fakeAgentPorts((text, intent) => delivered.push({ text, intent })),
		});

		await c.handlePttDown('submit');
		armed!(); // threshold elapsed → begins recording
		await tick();
		await c.handlePttUp(); // stop → transcribe → cleanup → deliver
		await tick();

		assert.equal(delivered.at(-1)?.intent, 'submit');
	});

	test('handleHotkey cancels a pending PTT arm instead of racing it into a second start', async () => {
		// A PTT hold that hasn't crossed the threshold yet leaves `arming` set.
		// `handleHotkey` must disarm it (cancel the scheduled timer) before doing
		// its own idle→start, so the (now-cancelled) arm timer can never fire
		// later and start a second, unwanted recording. Unlike a real scheduler
		// (setTimeout/clearTimeout), this mock keeps a live reference to the armed
		// callback so the test can invoke it *after* cancellation — proving the
		// cancel-guard itself (not just the scheduler's own semantics) is what
		// stops a late fire from starting a second recording.
		let armFn: (() => void) | null = null;
		let cancelled = false;
		const started: string[] = [];
		const invoke = (async (cmd: string) => {
			started.push(cmd);
			if (cmd === 'has_accessibility_permission') { return true; }
			if (cmd === 'stop_capture') { return '/tmp/rec.wav'; }
			return undefined;
		}) as unknown as ControllerDeps['invoke'];
		const c = makeController({
			invoke,
			schedule: (fn) => { armFn = fn; return () => { cancelled = true; }; },
		});

		await c.handlePttDown('insert'); // arms; hold not yet elapsed
		await c.handleHotkey(); // idle → start; must cancel the pending arm first

		assert.strictEqual(cancelled, true, 'a pending PTT arm must be cancelled by handleHotkey');

		// Simulate the timer firing anyway (the one thing a real scheduler would
		// never let happen once cancelled). If `handleHotkey`'s cancel-guard is
		// removed, this late fire calls `beginRecording()` again and doubles
		// `start_capture` — so this assertion only holds while the guard exists.
		armFn!();
		await tick();

		assert.strictEqual(
			started.filter((cmd) => cmd === 'start_capture').length,
			1,
			'only handleHotkey\'s own start may call start_capture; a late fire of the cancelled arm must never start a second one',
		);
	});

	test('a PTT release that races an in-flight start_capture is deferred, not dropped', async () => {
		// Models the window `beginRecording` guards with `startInFlight`/`pendingStop`:
		// the hold crosses the threshold (arm fires) and `start_capture` is still
		// pending when the key is released. The release must be remembered and
		// honored once the start settles — not lost.
		let armFn: (() => void) | null = null;
		let resolveStart: (() => void) | null = null;
		const invoke = sinon.stub();
		invoke.withArgs('start_capture').returns(new Promise<void>((resolve) => { resolveStart = resolve; }));
		invoke.withArgs('stop_capture').resolves('/tmp/rec.wav');
		invoke.withArgs('has_accessibility_permission').resolves(true);

		const delivered: Array<{ text: string; intent: string }> = [];
		const c = makeController({
			invoke: invoke as unknown as ControllerDeps['invoke'],
			schedule: (fn) => { armFn = fn; return () => { armFn = null; }; },
			delivery: fakeAgentPorts((text, intent) => delivered.push({ text, intent })),
		});

		await c.handlePttDown('insert'); // arms; hold not yet elapsed
		armFn!(); // threshold elapsed → beginRecording() starts; start_capture is now in flight
		await c.handlePttUp(); // release races the in-flight start → deferred via pendingStop, not dropped

		assert.strictEqual(
			invoke.withArgs('stop_capture').called,
			false,
			'stop_capture must not fire until start_capture has resolved',
		);

		resolveStart!();
		await tick();
		await tick();

		assert.strictEqual(
			invoke.withArgs('stop_capture').callCount,
			1,
			'the deferred release must still trigger exactly one stop_capture — never lost, never doubled',
		);
		assert.strictEqual(delivered.length, 1, 'the deferred release must still complete delivery');
	});
});
