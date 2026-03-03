import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

import * as recorder from '../../recorder';

// --- Fake Deepgram SDK ---

// Fake LiveTranscriptionEvents enum matching @deepgram/sdk
const FakeLiveTranscriptionEvents = {
	Open: 'open',
	Transcript: 'Results',
	UtteranceEnd: 'UtteranceEnd',
	Error: 'error',
	Close: 'close',
};

class FakeDeepgramConnection extends EventEmitter {
	send = sinon.stub();
	requestClose = sinon.stub();
}

function createFakeDeepgramSdk(fakeConnection: FakeDeepgramConnection) {
	return {
		createClient: sinon.stub().returns({
			listen: {
				live: sinon.stub().returns(fakeConnection),
			},
		}),
		LiveTranscriptionEvents: FakeLiveTranscriptionEvents,
	};
}

// Register fake @deepgram/sdk in require.cache before importing ContinuousRecorder
let fakeConnection: FakeDeepgramConnection;
let fakeDeepgramSdk: ReturnType<typeof createFakeDeepgramSdk>;

function installFakeDeepgramSdk() {
	fakeConnection = new FakeDeepgramConnection();
	fakeDeepgramSdk = createFakeDeepgramSdk(fakeConnection);

	// Register in require.cache so that require('@deepgram/sdk') returns our fake
	const deepgramModuleId = require.resolve('@deepgram/sdk');
	require.cache[deepgramModuleId] = {
		id: deepgramModuleId,
		filename: deepgramModuleId,
		loaded: true,
		exports: fakeDeepgramSdk,
		children: [],
		paths: [],
		path: '',
		isPreloading: false,
		require: require,
	} as any;
}

// Install before importing ContinuousRecorder
installFakeDeepgramSdk();

import { ContinuousRecorder, TranscriptEvent } from '../../continuousRecorder';

// --- Fake ffmpeg process ---

interface WritableFakeChildProcess extends EventEmitter {
	stdin: {
		destroyed: boolean;
		write: sinon.SinonStub;
	};
	stdout: EventEmitter;
	stderr: EventEmitter;
	killed: boolean;
	kill: sinon.SinonStub;
	pid: number;
}

function createWritableFakeProcess(): WritableFakeChildProcess {
	const proc = new EventEmitter() as WritableFakeChildProcess;
	proc.stdin = {
		destroyed: false,
		write: sinon.stub().callsFake(
			(_data: string, cb?: (err?: Error | null) => void) => {
				if (cb) { cb(); }
				return true;
			}
		),
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.killed = false;
	proc.kill = sinon.stub().callsFake(() => {
		proc.killed = true;
		return true;
	});
	proc.pid = 99999;
	return proc;
}

suite('ContinuousRecorder (Deepgram)', () => {
	let cr: ContinuousRecorder;
	let fakeProcess: WritableFakeChildProcess;
	let clock: sinon.SinonFakeTimers;
	let spawnStub: sinon.SinonStub;
	let findFfmpegStub: sinon.SinonStub;
	let getPlatformAudioConfigStub: sinon.SinonStub;

	setup(() => {
		// Reinstall fake SDK to get fresh mocks
		installFakeDeepgramSdk();

		fakeProcess = createWritableFakeProcess();
		clock = sinon.useFakeTimers();

		findFfmpegStub = sinon.stub(recorder, 'findFfmpeg').returns('/opt/homebrew/bin/ffmpeg');
		getPlatformAudioConfigStub = sinon.stub(recorder, 'getPlatformAudioConfig').returns({
			inputFormat: 'avfoundation',
			inputDevice: ':default',
		});
		spawnStub = sinon.stub(child_process, 'spawn').returns(
			fakeProcess as unknown as child_process.ChildProcess
		);

		cr = new ContinuousRecorder('dg-test-api-key');
	});

	teardown(() => {
		clock.restore();
		sinon.restore();
	});

	/**
	 * Starts the recorder by:
	 * 1. Calling cr.start()
	 * 2. Emitting 'open' on the fake Deepgram connection (to resolve the connection promise)
	 * 3. Advancing the fake clock by 500ms (to resolve the ffmpeg startup heuristic)
	 */
	async function startRecording(): Promise<void> {
		const startPromise = cr.start();
		// Simulate Deepgram connection opening
		fakeConnection.emit(FakeLiveTranscriptionEvents.Open);
		// Advance clock to pass the 500ms ffmpeg startup heuristic
		await clock.tickAsync(500);
		await startPromise;
	}

	suite('constructor and properties', () => {
		test('isRecording is false initially', () => {
			assert.strictEqual(cr.isRecording, false);
		});

		test('utteranceCount is 0 initially', () => {
			assert.strictEqual(cr.utteranceCount, 0);
		});
	});

	suite('start()', () => {
		test('creates Deepgram connection and starts ffmpeg', async () => {
			await startRecording();

			assert.ok(fakeDeepgramSdk.createClient.calledOnce, 'createClient should be called');
			assert.ok(fakeDeepgramSdk.createClient.calledWith('dg-test-api-key'), 'createClient should receive API key');
			assert.ok(spawnStub.calledOnce, 'spawn should be called for ffmpeg');

			const args = spawnStub.firstCall.args[1] as string[];
			assert.ok(args.includes('s16le'), 'ffmpeg should output s16le format');
			assert.ok(args.includes('16000'), 'ffmpeg should use 16kHz sample rate');
			assert.ok(args.includes('pipe:1'), 'ffmpeg should pipe to stdout');
		});

		test('isRecording is true after start resolves', async () => {
			assert.strictEqual(cr.isRecording, false);
			await startRecording();
			assert.strictEqual(cr.isRecording, true);
		});

		test('throws if already recording', async () => {
			await startRecording();
			await assert.rejects(
				() => cr.start(),
				/already in progress/
			);
		});

		test('throws if ffmpeg not found', async () => {
			findFfmpegStub.returns(null);
			await assert.rejects(
				() => cr.start(),
				/ffmpeg not found/
			);
		});

		test('pipes ffmpeg stdout data to Deepgram connection', async () => {
			await startRecording();

			const audioChunk = Buffer.from([0x01, 0x02, 0x03, 0x04]);
			fakeProcess.stdout.emit('data', audioChunk);

			assert.ok(fakeConnection.send.calledOnce, 'Deepgram send should be called');
			assert.ok(fakeConnection.send.calledWith(audioChunk), 'Deepgram should receive the audio chunk');
		});
	});

	suite('Transcript events', () => {
		test('is_final transcript accumulates into pendingTranscript', async () => {
			await startRecording();

			const transcriptEvents: TranscriptEvent[] = [];
			cr.on('transcript', (evt: TranscriptEvent) => transcriptEvents.push(evt));

			// Emit a final transcript
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'Hello world' }] },
				is_final: true,
			});

			// No 'transcript' event yet (waiting for UtteranceEnd)
			assert.strictEqual(transcriptEvents.length, 0);
		});

		test('UtteranceEnd emits transcript with accumulated text', async () => {
			await startRecording();

			const transcriptEvents: TranscriptEvent[] = [];
			cr.on('transcript', (evt: TranscriptEvent) => transcriptEvents.push(evt));

			// Accumulate two final transcripts
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'Hello' }] },
				is_final: true,
			});
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'world' }] },
				is_final: true,
			});

			// Trigger utterance end
			fakeConnection.emit(FakeLiveTranscriptionEvents.UtteranceEnd);

			assert.strictEqual(transcriptEvents.length, 1);
			assert.strictEqual(transcriptEvents[0].text, 'Hello world');
			assert.strictEqual(transcriptEvents[0].isFinal, true);
			assert.strictEqual(transcriptEvents[0].utteranceIndex, 0);
		});

		test('multiple utterances increment utteranceIndex', async () => {
			await startRecording();

			const transcriptEvents: TranscriptEvent[] = [];
			cr.on('transcript', (evt: TranscriptEvent) => transcriptEvents.push(evt));

			// First utterance
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'First sentence' }] },
				is_final: true,
			});
			fakeConnection.emit(FakeLiveTranscriptionEvents.UtteranceEnd);

			// Second utterance
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'Second sentence' }] },
				is_final: true,
			});
			fakeConnection.emit(FakeLiveTranscriptionEvents.UtteranceEnd);

			assert.strictEqual(transcriptEvents.length, 2);
			assert.strictEqual(transcriptEvents[0].utteranceIndex, 0);
			assert.strictEqual(transcriptEvents[1].utteranceIndex, 1);
			assert.strictEqual(cr.utteranceCount, 2);
		});

		test('interim (non-final) transcript emits interim event', async () => {
			await startRecording();

			const interimTexts: string[] = [];
			cr.on('interim', (text: string) => interimTexts.push(text));

			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'partial text' }] },
				is_final: false,
			});

			assert.strictEqual(interimTexts.length, 1);
			assert.strictEqual(interimTexts[0], 'partial text');
		});

		test('empty transcript is ignored', async () => {
			await startRecording();

			const transcriptEvents: TranscriptEvent[] = [];
			const interimTexts: string[] = [];
			cr.on('transcript', (evt: TranscriptEvent) => transcriptEvents.push(evt));
			cr.on('interim', (text: string) => interimTexts.push(text));

			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: '' }] },
				is_final: true,
			});
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: '' }] },
				is_final: false,
			});

			assert.strictEqual(transcriptEvents.length, 0);
			assert.strictEqual(interimTexts.length, 0);
		});

		test('UtteranceEnd with no pending transcript does not emit', async () => {
			await startRecording();

			const transcriptEvents: TranscriptEvent[] = [];
			cr.on('transcript', (evt: TranscriptEvent) => transcriptEvents.push(evt));

			fakeConnection.emit(FakeLiveTranscriptionEvents.UtteranceEnd);

			assert.strictEqual(transcriptEvents.length, 0);
		});
	});

	suite('stop()', () => {
		test('flushes pending transcript on stop', async () => {
			await startRecording();

			const transcriptEvents: TranscriptEvent[] = [];
			cr.on('transcript', (evt: TranscriptEvent) => transcriptEvents.push(evt));

			// Accumulate text but do NOT trigger UtteranceEnd
			fakeConnection.emit(FakeLiveTranscriptionEvents.Transcript, {
				channel: { alternatives: [{ transcript: 'unsent text' }] },
				is_final: true,
			});

			assert.strictEqual(transcriptEvents.length, 0, 'Should not emit before stop');

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.strictEqual(transcriptEvents.length, 1, 'Should flush on stop');
			assert.strictEqual(transcriptEvents[0].text, 'unsent text');
			assert.strictEqual(transcriptEvents[0].isFinal, true);
		});

		test('stops ffmpeg and closes Deepgram connection', async () => {
			await startRecording();

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(fakeProcess.stdin.write.calledWith('q', sinon.match.func), 'Should send q to ffmpeg');
			assert.ok(fakeConnection.requestClose.calledOnce, 'Should close Deepgram connection');
		});

		test('sets isRecording to false', async () => {
			await startRecording();
			assert.strictEqual(cr.isRecording, true);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.strictEqual(cr.isRecording, false);
		});

		test('emits stopped event', async () => {
			await startRecording();

			const stoppedSpy = sinon.spy();
			cr.on('stopped', stoppedSpy);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(stoppedSpy.calledOnce, 'Should emit stopped event');
		});

		test('throws if not recording', async () => {
			await assert.rejects(
				() => cr.stop(),
				/No continuous recording in progress/
			);
		});

		test('falls back to SIGKILL when stdin.write fails', async () => {
			await startRecording();

			fakeProcess.stdin.write = sinon.stub().callsFake(
				(_data: string, cb?: (err?: Error | null) => void) => {
					if (cb) { cb(new Error('EPIPE')); }
					return true;
				}
			);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(fakeProcess.kill.calledWith('SIGKILL'), 'Should fall back to SIGKILL');
		});

		test('falls back to SIGKILL when stdin is destroyed', async () => {
			await startRecording();
			(fakeProcess.stdin as any).destroyed = true;

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(fakeProcess.kill.calledWith('SIGKILL'), 'Should fall back to SIGKILL');
		});
	});

	suite('dispose()', () => {
		test('kills ffmpeg and closes Deepgram connection', async () => {
			await startRecording();

			cr.dispose();

			assert.ok(fakeProcess.kill.calledWith('SIGKILL'), 'Should kill ffmpeg');
			assert.ok(fakeConnection.requestClose.calledOnce, 'Should close Deepgram');
			assert.strictEqual(cr.isRecording, false);
		});

		test('is safe to call when not recording', () => {
			assert.doesNotThrow(() => cr.dispose());
		});

		test('sets isRecording to false', async () => {
			await startRecording();
			assert.strictEqual(cr.isRecording, true);
			cr.dispose();
			assert.strictEqual(cr.isRecording, false);
		});
	});

	suite('error handling', () => {
		test('ffmpeg crash emits error + stopped', async () => {
			await startRecording();

			const errorEvents: Error[] = [];
			const stoppedSpy = sinon.spy();
			cr.on('error', (err: Error) => errorEvents.push(err));
			cr.on('stopped', stoppedSpy);

			fakeProcess.emit('close', 1);

			assert.strictEqual(cr.isRecording, false);
			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0].message.includes('unexpectedly'));
			assert.ok(stoppedSpy.calledOnce);
		});

		test('Deepgram error event emits error on recorder', async () => {
			await startRecording();

			const errorEvents: Error[] = [];
			cr.on('error', (err: Error) => errorEvents.push(err));

			fakeConnection.emit(FakeLiveTranscriptionEvents.Error, new Error('WebSocket failure'));

			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0].message.includes('WebSocket failure'));
		});

		test('Deepgram error event wraps non-Error values', async () => {
			await startRecording();

			const errorEvents: Error[] = [];
			cr.on('error', (err: Error) => errorEvents.push(err));

			fakeConnection.emit(FakeLiveTranscriptionEvents.Error, 'string error');

			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0] instanceof Error);
			assert.ok(errorEvents[0].message.includes('string error'));
		});
	});
});
