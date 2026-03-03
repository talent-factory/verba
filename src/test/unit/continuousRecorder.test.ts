import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as fs from 'fs';
import { EventEmitter } from 'events';

import { parseSilenceEvent, SilenceEvent, SegmentEvent, ContinuousRecorder } from '../../continuousRecorder';
import * as recorder from '../../recorder';

// FakeChildProcess for extractSegment tests (simple stdin EventEmitter)
interface FakeChildProcess extends EventEmitter {
	stdin: EventEmitter;
	stdout: EventEmitter;
	stderr: EventEmitter;
	killed: boolean;
	kill: sinon.SinonStub;
	pid: number;
}

function createFakeProcess(): FakeChildProcess {
	const proc = new EventEmitter() as FakeChildProcess;
	proc.stdin = new EventEmitter();
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

// FakeChildProcess for lifecycle tests (writable stdin with write method)
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

suite('parseSilenceEvent', () => {

	test('parses silence_start line', () => {
		const result = parseSilenceEvent('[silencedetect @ 0x7f8] silence_start: 3.504');
		assert.deepStrictEqual(result, { type: 'silence_start', time: 3.504 } as SilenceEvent);
	});

	test('parses silence_end line', () => {
		const result = parseSilenceEvent('[silencedetect @ 0x7f8] silence_end: 5.123 | silence_duration: 1.619');
		assert.deepStrictEqual(result, { type: 'silence_end', time: 5.123 } as SilenceEvent);
	});

	test('returns null for non-silence lines', () => {
		const result = parseSilenceEvent('size= 128kB time=00:00:08.00');
		assert.strictEqual(result, null);
	});

	test('returns null for empty string', () => {
		const result = parseSilenceEvent('');
		assert.strictEqual(result, null);
	});

	test('handles decimal precision variations', () => {
		// Single decimal place
		const r1 = parseSilenceEvent('[silencedetect @ 0x7f8] silence_start: 12.5');
		assert.deepStrictEqual(r1, { type: 'silence_start', time: 12.5 });

		// Zero value
		const r2 = parseSilenceEvent('[silencedetect @ 0x7f8] silence_start: 0.0');
		assert.deepStrictEqual(r2, { type: 'silence_start', time: 0.0 });

		// Three decimal places
		const r3 = parseSilenceEvent('[silencedetect @ 0x7f8] silence_end: 100.123 | silence_duration: 2.000');
		assert.deepStrictEqual(r3, { type: 'silence_end', time: 100.123 });
	});

	test('handles lines with extra whitespace', () => {
		const r1 = parseSilenceEvent('  [silencedetect @ 0x7f8] silence_start: 3.504  ');
		assert.deepStrictEqual(r1, { type: 'silence_start', time: 3.504 });

		const r2 = parseSilenceEvent('  [silencedetect @ 0x7f8] silence_end: 5.123 | silence_duration: 1.619  ');
		assert.deepStrictEqual(r2, { type: 'silence_end', time: 5.123 });
	});
});

suite('ContinuousRecorder', () => {
	let cr: ContinuousRecorder;
	let fakeProcess: FakeChildProcess;
	let findFfmpegStub: sinon.SinonStub;
	let spawnStub: sinon.SinonStub;

	setup(() => {
		cr = new ContinuousRecorder('/tmp/verba-continuous-123.wav');
		fakeProcess = createFakeProcess();
		findFfmpegStub = sinon.stub(recorder, 'findFfmpeg').returns('/opt/homebrew/bin/ffmpeg');
		spawnStub = sinon.stub(child_process, 'spawn').returns(
			fakeProcess as unknown as child_process.ChildProcess
		);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('constructor and properties', () => {
		test('outputPath returns the path passed to constructor', () => {
			assert.strictEqual(cr.outputPath, '/tmp/verba-continuous-123.wav');
		});

		test('isRecording is false initially', () => {
			assert.strictEqual(cr.isRecording, false);
		});
	});

	suite('extractSegment()', () => {
		test('spawns ffmpeg with correct -ss and -to arguments', async () => {
			const promise = cr.extractSegment(1.5, 4.2);
			fakeProcess.emit('close', 0);
			await promise;

			assert.ok(spawnStub.calledOnce, 'Expected spawn to be called once');
			const args = spawnStub.firstCall.args[1] as string[];
			assert.ok(args.includes('-ss'), 'Expected -ss in args');
			assert.ok(args.includes('1.5'), 'Expected start time 1.5 in args');
			assert.ok(args.includes('-to'), 'Expected -to in args');
			assert.ok(args.includes('4.2'), 'Expected end time 4.2 in args');
			assert.ok(args.includes('-i'), 'Expected -i in args');
			assert.ok(args.includes('/tmp/verba-continuous-123.wav'), 'Expected input file in args');
			assert.ok(args.includes('-ar'), 'Expected -ar in args');
			assert.ok(args.includes('16000'), 'Expected 16000 sample rate in args');
			assert.ok(args.includes('-ac'), 'Expected -ac in args');
			assert.ok(args.includes('1'), 'Expected mono channel in args');
			assert.ok(args.includes('-acodec'), 'Expected -acodec in args');
			assert.ok(args.includes('pcm_s16le'), 'Expected pcm_s16le codec in args');
			assert.ok(args.includes('-y'), 'Expected -y overwrite flag in args');
		});

		test('on close code 0 emits segment event with correct payload', async () => {
			const segmentEvents: SegmentEvent[] = [];
			cr.on('segment', (evt: SegmentEvent) => segmentEvents.push(evt));

			const promise = cr.extractSegment(2.0, 5.5);
			fakeProcess.emit('close', 0);
			await promise;

			assert.strictEqual(segmentEvents.length, 1);
			assert.strictEqual(segmentEvents[0].startTime, 2.0);
			assert.strictEqual(segmentEvents[0].endTime, 5.5);
			assert.strictEqual(segmentEvents[0].segmentIndex, 0);
			assert.ok(segmentEvents[0].segmentPath.endsWith('-seg-0.wav'));
			assert.ok(segmentEvents[0].segmentPath.includes('verba-continuous-123'));
		});

		test('on close code != 0 emits error event, no segment event', async () => {
			const segmentEvents: SegmentEvent[] = [];
			const errorEvents: Error[] = [];
			cr.on('segment', (evt: SegmentEvent) => segmentEvents.push(evt));
			cr.on('error', (evt: Error) => errorEvents.push(evt));

			const promise = cr.extractSegment(1.0, 3.0);
			fakeProcess.emit('close', 1);
			await promise;

			assert.strictEqual(segmentEvents.length, 0, 'Should not emit segment on error');
			assert.strictEqual(errorEvents.length, 1, 'Should emit one error event');
			assert.ok(errorEvents[0] instanceof Error);
			assert.ok(errorEvents[0].message.includes('1'), 'Error message should include exit code');
		});

		test('on spawn error emits error event', async () => {
			const errorEvents: Error[] = [];
			cr.on('error', (evt: Error) => errorEvents.push(evt));

			const promise = cr.extractSegment(0, 2.0);
			fakeProcess.emit('error', new Error('spawn ENOENT'));
			await promise;

			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0] instanceof Error);
			assert.ok(errorEvents[0].message.includes('ENOENT'));
		});

		test('increments segment index across multiple extractions', async () => {
			const segmentEvents: SegmentEvent[] = [];
			cr.on('segment', (evt: SegmentEvent) => segmentEvents.push(evt));

			// First extraction
			const p1 = cr.extractSegment(0, 1.0);
			fakeProcess.emit('close', 0);
			await p1;

			// Reset fakeProcess for second call
			fakeProcess = createFakeProcess();
			spawnStub.returns(fakeProcess as unknown as child_process.ChildProcess);

			// Second extraction
			const p2 = cr.extractSegment(2.0, 3.0);
			fakeProcess.emit('close', 0);
			await p2;

			// Reset fakeProcess for third call
			fakeProcess = createFakeProcess();
			spawnStub.returns(fakeProcess as unknown as child_process.ChildProcess);

			// Third extraction
			const p3 = cr.extractSegment(4.0, 5.0);
			fakeProcess.emit('close', 0);
			await p3;

			assert.strictEqual(segmentEvents.length, 3);
			assert.strictEqual(segmentEvents[0].segmentIndex, 0);
			assert.strictEqual(segmentEvents[1].segmentIndex, 1);
			assert.strictEqual(segmentEvents[2].segmentIndex, 2);
			assert.ok(segmentEvents[0].segmentPath.endsWith('-seg-0.wav'));
			assert.ok(segmentEvents[1].segmentPath.endsWith('-seg-1.wav'));
			assert.ok(segmentEvents[2].segmentPath.endsWith('-seg-2.wav'));
		});

		test('if findFfmpeg returns null emits error and returns without spawning', async () => {
			findFfmpegStub.returns(null);

			const errorEvents: Error[] = [];
			cr.on('error', (evt: Error) => errorEvents.push(evt));

			await cr.extractSegment(0, 1.0);

			assert.strictEqual(spawnStub.called, false, 'Should not spawn ffmpeg');
			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0] instanceof Error);
			assert.ok(errorEvents[0].message.toLowerCase().includes('ffmpeg'));
		});
	});
});

suite('ContinuousRecorder lifecycle', () => {
	let cr: ContinuousRecorder;
	let fakeProcess: WritableFakeChildProcess;
	let clock: sinon.SinonFakeTimers;
	let spawnStub: sinon.SinonStub;
	let findFfmpegStub: sinon.SinonStub;
	let getPlatformAudioConfigStub: sinon.SinonStub;

	setup(() => {
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
	});

	teardown(() => {
		clock.restore();
		sinon.restore();
	});

	function freshRecorder(silenceThreshold?: number, silenceLevel?: number): ContinuousRecorder {
		return new ContinuousRecorder(undefined, silenceThreshold, silenceLevel);
	}

	async function startRecording(recorder: ContinuousRecorder): Promise<void> {
		const startPromise = recorder.start();
		await clock.tickAsync(500);
		await startPromise;
	}

	suite('start()', () => {
		test('spawns ffmpeg with silencedetect filter using default parameters', async () => {
			cr = freshRecorder();
			await startRecording(cr);

			assert.ok(spawnStub.calledOnce, 'Expected spawn to be called once');
			const args = spawnStub.firstCall.args[1] as string[];
			assert.ok(
				args.some(a => a.includes('silencedetect=n=-30dB:d=1.5')),
				`Expected silencedetect filter in args, got: ${args.join(' ')}`
			);
		});

		test('isRecording is true after start resolves', async () => {
			cr = freshRecorder();
			assert.strictEqual(cr.isRecording, false);
			await startRecording(cr);
			assert.strictEqual(cr.isRecording, true);
		});

		test('throws if already recording', async () => {
			cr = freshRecorder();
			await startRecording(cr);
			await assert.rejects(
				() => cr.start(),
				/Recording already in progress/
			);
		});

		test('throws if ffmpeg not found', async () => {
			cr = freshRecorder();
			findFfmpegStub.returns(null);
			await assert.rejects(
				() => cr.start(),
				/ffmpeg not found/
			);
		});

		test('custom silenceThreshold and silenceLevel are used in args', async () => {
			cr = freshRecorder(2.0, -40);
			await startRecording(cr);

			const args = spawnStub.firstCall.args[1] as string[];
			assert.ok(
				args.some(a => a.includes('silencedetect=n=-40dB:d=2')),
				`Expected silencedetect=n=-40dB:d=2 in args, got: ${args.join(' ')}`
			);
		});

		test('stderr data triggers parseSilenceEvent — on silence_end, calls extractSegment', async () => {
			cr = freshRecorder();
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();

			await startRecording(cr);

			// Emit silence_start
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 3.5\n'
			));

			// silence_start should NOT trigger extractSegment
			assert.strictEqual(extractStub.callCount, 0, 'extractSegment should not be called on silence_start');

			// Emit silence_end — should trigger extractSegment
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_end: 5.0 | silence_duration: 1.5\n'
			));

			assert.strictEqual(extractStub.callCount, 1, 'extractSegment should be called once on silence_end');
			// First arg: startTime (lastSegmentEnd=0), second: endTime (lastSilenceStart=3.5)
			assert.strictEqual(extractStub.firstCall.args[0], 0, 'startTime should be 0 (lastSegmentEnd)');
			assert.strictEqual(extractStub.firstCall.args[1], 3.5, 'endTime should be 3.5 (lastSilenceStart)');
		});

		test('buffers incomplete stderr lines across data events', async () => {
			cr = freshRecorder();
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();

			await startRecording(cr);

			// Emit partial line
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 3'
			));

			// No complete line yet — should not trigger anything
			assert.strictEqual(extractStub.callCount, 0);

			// Complete the line + add silence_end
			fakeProcess.stderr.emit('data', Buffer.from(
				'.5\n[silencedetect @ 0x7f8] silence_end: 5.0 | silence_duration: 1.5\n'
			));

			assert.strictEqual(extractStub.callCount, 1, 'extractSegment should be called after complete silence_end line');
		});

		test('rejects when process emits error before timeout', async () => {
			cr = freshRecorder();
			const startPromise = cr.start();
			fakeProcess.emit('error', new Error('spawn ENOENT'));

			await assert.rejects(
				startPromise,
				/ffmpeg failed to start: spawn ENOENT/
			);
		});

		test('rejects when process closes before timeout with code 1', async () => {
			cr = freshRecorder();
			const startPromise = cr.start();
			fakeProcess.emit('close', 1);

			await assert.rejects(
				startPromise,
				/Microphone access denied/
			);
		});

		test('generates output path in temp directory when not provided', async () => {
			cr = freshRecorder();
			await startRecording(cr);

			assert.ok(cr.outputPath.includes('verba-continuous-'), `Expected verba-continuous- in path, got ${cr.outputPath}`);
			assert.ok(cr.outputPath.endsWith('.wav'), `Expected .wav extension, got ${cr.outputPath}`);
		});

		test('resets segment count on start', async () => {
			cr = new ContinuousRecorder('/tmp/verba-continuous-test.wav');
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();

			await startRecording(cr);

			// Trigger a silence event to cause extraction
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 1.0\n'
				+ '[silencedetect @ 0x7f8] silence_end: 2.5 | silence_duration: 1.5\n'
			));
			assert.strictEqual(extractStub.callCount, 1);

			// Stop and restart — segment count should reset
			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			// Reset fakeProcess for re-start
			fakeProcess = createWritableFakeProcess();
			spawnStub.returns(fakeProcess as unknown as child_process.ChildProcess);

			// extractSegment was called during stop for final segment; reset stub
			extractStub.resetHistory();

			await startRecording(cr);

			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 1.0\n'
				+ '[silencedetect @ 0x7f8] silence_end: 2.0 | silence_duration: 1.0\n'
			));

			// The startTime should be 0 again (reset)
			assert.strictEqual(extractStub.firstCall.args[0], 0, 'startTime should be 0 after restart');
		});
	});

	suite('stop()', () => {
		test('sets isRecording to false', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);
			assert.strictEqual(cr.isRecording, true);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.strictEqual(cr.isRecording, false);
		});

		test('emits stopped event', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			const stoppedSpy = sinon.spy();
			cr.on('stopped', stoppedSpy);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(stoppedSpy.calledOnce, 'Expected stopped event to be emitted once');
		});

		test('throws if not recording', async () => {
			cr = freshRecorder();
			await assert.rejects(
				() => cr.stop(),
				/No recording in progress/
			);
		});

		test('sends q to stdin for graceful shutdown', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(
				fakeProcess.stdin.write.calledWith('q', sinon.match.func),
				'Expected stdin.write to be called with "q"'
			);
		});

		test('returns output path', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			const result = await stopPromise;

			assert.ok(result.includes('verba-continuous-'), `Expected path to contain verba-continuous-, got ${result}`);
			assert.ok(result.endsWith('.wav'), `Expected path to end with .wav, got ${result}`);
		});

		test('extracts final segment on stop', async () => {
			cr = freshRecorder();
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			// Should extract final segment from lastSegmentEnd (0) to a large endTime
			assert.ok(extractStub.calledOnce, 'Expected extractSegment to be called for final segment');
			assert.strictEqual(extractStub.firstCall.args[0], 0, 'startTime should be 0');
			assert.ok(extractStub.firstCall.args[1] >= 99999, 'endTime should be a large number');
		});

		test('falls back to SIGKILL when stdin.write fails', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			fakeProcess.stdin.write = sinon.stub().callsFake(
				(_data: string, cb?: (err?: Error | null) => void) => {
					if (cb) { cb(new Error('EPIPE')); }
					return true;
				}
			);

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(
				fakeProcess.kill.calledWith('SIGKILL'),
				'Expected SIGKILL fallback when stdin.write fails'
			);
		});

		test('sends SIGKILL after 3s if process does not exit', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			cr.stop();
			await clock.tickAsync(3000);

			assert.ok(
				fakeProcess.kill.calledWith('SIGKILL'),
				'Expected process.kill("SIGKILL") after 3s timeout'
			);
		});

		test('final segment uses updated lastSegmentEnd after silence events', async () => {
			cr = freshRecorder();
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			// Simulate silence detection during recording
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 3.0\n'
				+ '[silencedetect @ 0x7f8] silence_end: 5.0 | silence_duration: 2.0\n'
			));

			// extractSegment was called with (0, 3.0) and lastSegmentEnd is now 5.0
			assert.strictEqual(extractStub.callCount, 1);
			extractStub.resetHistory();

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			// Final segment should start at 5.0 (the updated lastSegmentEnd)
			assert.strictEqual(extractStub.callCount, 1, 'Should call extractSegment for final segment');
			assert.strictEqual(extractStub.firstCall.args[0], 5.0, 'Final segment startTime should be 5.0');
			assert.ok(extractStub.firstCall.args[1] >= 99999, 'Final segment endTime should be large');
		});
	});

	suite('dispose()', () => {
		test('kills process if running', async () => {
			cr = freshRecorder();
			await startRecording(cr);

			const unlinkStub = sinon.stub(fs, 'unlinkSync');
			cr.dispose();

			assert.ok(fakeProcess.kill.calledWith('SIGKILL'), 'Expected process to be killed');
			unlinkStub.restore();
		});

		test('sets isRecording to false', async () => {
			cr = freshRecorder();
			await startRecording(cr);
			assert.strictEqual(cr.isRecording, true);

			sinon.stub(fs, 'unlinkSync');
			cr.dispose();

			assert.strictEqual(cr.isRecording, false);
		});

		test('deletes output file', async () => {
			cr = freshRecorder();
			await startRecording(cr);
			const outputPath = cr.outputPath;

			const unlinkStub = sinon.stub(fs, 'unlinkSync');
			cr.dispose();

			assert.ok(unlinkStub.calledWith(outputPath), 'Expected unlinkSync to be called with outputPath');
		});

		test('is safe to call when not recording', () => {
			cr = freshRecorder();
			assert.doesNotThrow(() => cr.dispose());
		});

		test('does not throw when unlinkSync fails', async () => {
			cr = freshRecorder();
			await startRecording(cr);
			sinon.stub(fs, 'unlinkSync').throws(new Error('EPERM'));

			assert.doesNotThrow(() => cr.dispose());
		});
	});
});
