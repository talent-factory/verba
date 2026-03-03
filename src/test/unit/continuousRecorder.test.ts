import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
		let rawFilePath: string;

		setup(() => {
			// Create a real raw PCM file with 3 seconds of sine wave data
			// (16kHz, mono, 16-bit = 32000 bytes/sec = 96000 bytes for 3s)
			rawFilePath = path.join(os.tmpdir(), `verba-test-extract-${Date.now()}.wav`);
			const bytesPerSec = 32000;
			const durationSec = 3;
			const pcmBytes = bytesPerSec * durationSec;
			const pcmBuf = Buffer.alloc(pcmBytes);
			for (let i = 0; i < pcmBytes; i += 2) {
				const sample = Math.floor(Math.sin(i / 10) * 10000);
				pcmBuf.writeInt16LE(sample, i);
			}
			// Write WAV file with proper header (44 bytes) + PCM data
			const wavHeader = Buffer.alloc(44);
			wavHeader.write('RIFF', 0);
			wavHeader.writeUInt32LE(36 + pcmBytes, 4);
			wavHeader.write('WAVE', 8);
			wavHeader.write('fmt ', 12);
			wavHeader.writeUInt32LE(16, 16);
			wavHeader.writeUInt16LE(1, 20);
			wavHeader.writeUInt16LE(1, 22);
			wavHeader.writeUInt32LE(16000, 24);
			wavHeader.writeUInt32LE(32000, 28);
			wavHeader.writeUInt16LE(2, 32);
			wavHeader.writeUInt16LE(16, 34);
			wavHeader.write('data', 36);
			wavHeader.writeUInt32LE(pcmBytes, 40);
			fs.writeFileSync(rawFilePath, Buffer.concat([wavHeader, pcmBuf]));
			cr = new ContinuousRecorder(rawFilePath);
		});

		teardown(() => {
			try { fs.unlinkSync(rawFilePath); } catch { /* ignore */ }
			for (let i = 0; i < 10; i++) {
				try { fs.unlinkSync(rawFilePath.replace(/\.wav$/, `-seg-${i}.wav`)); } catch { /* ignore */ }
			}
		});

		test('emits segment event with correct payload and creates valid WAV', async () => {
			const segmentEvents: SegmentEvent[] = [];
			cr.on('segment', (evt: SegmentEvent) => segmentEvents.push(evt));

			await cr.extractSegment(0.5, 2.0);

			assert.strictEqual(segmentEvents.length, 1);
			assert.strictEqual(segmentEvents[0].startTime, 0.5);
			assert.strictEqual(segmentEvents[0].endTime, 2.0);
			assert.strictEqual(segmentEvents[0].segmentIndex, 0);
			assert.ok(segmentEvents[0].segmentPath.endsWith('-seg-0.wav'));

			const wavData = fs.readFileSync(segmentEvents[0].segmentPath);
			assert.ok(wavData.length > 44, 'WAV file should have header + data');
			assert.strictEqual(wavData.toString('ascii', 0, 4), 'RIFF');
			assert.strictEqual(wavData.toString('ascii', 8, 12), 'WAVE');
			assert.strictEqual(wavData.readUInt32LE(24), 16000);
			assert.strictEqual(wavData.readUInt16LE(22), 1);
			assert.strictEqual(wavData.readUInt16LE(34), 16);
			const dataSize = wavData.readUInt32LE(40);
			assert.strictEqual(dataSize, 48000, 'Data size should be 1.5s * 32000');
		});

		test('emits error for non-existent file', async () => {
			const badCr = new ContinuousRecorder('/tmp/nonexistent-file.wav');
			const errorEvents: Error[] = [];
			badCr.on('error', (evt: Error) => errorEvents.push(evt));
			await badCr.extractSegment(0, 2);
			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0].message.includes('extraction failed'));
		});

		test('emits error when start offset is past end of file', async () => {
			const errorEvents: Error[] = [];
			cr.on('error', (evt: Error) => errorEvents.push(evt));
			await cr.extractSegment(10.0, 15.0);
			assert.strictEqual(errorEvents.length, 1);
			assert.ok(errorEvents[0].message.includes('no audio data'));
		});

		test('increments segment index across multiple extractions', async () => {
			const segmentEvents: SegmentEvent[] = [];
			cr.on('segment', (evt: SegmentEvent) => segmentEvents.push(evt));
			await cr.extractSegment(0.0, 1.0);
			await cr.extractSegment(1.0, 2.0);
			await cr.extractSegment(2.0, 3.0);
			assert.strictEqual(segmentEvents.length, 3);
			assert.strictEqual(segmentEvents[0].segmentIndex, 0);
			assert.strictEqual(segmentEvents[1].segmentIndex, 1);
			assert.strictEqual(segmentEvents[2].segmentIndex, 2);
		});

		test('handles endTime=999999 by reading to end of file', async () => {
			const segmentEvents: SegmentEvent[] = [];
			cr.on('segment', (evt: SegmentEvent) => segmentEvents.push(evt));
			await cr.extractSegment(1.0, 999999);
			assert.strictEqual(segmentEvents.length, 1);
			const wavData = fs.readFileSync(segmentEvents[0].segmentPath);
			const dataSize = wavData.readUInt32LE(40);
			assert.strictEqual(dataSize, 64000, '2.0s * 32000 bytes/s');
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
			assert.strictEqual(extractStub.firstCall.args[1], 3.8, 'endTime should be 3.5+0.3 buffer (lastSilenceStart+0.3)');
		});

		test('silence_end without prior silence_start does not trigger extractSegment', async () => {
			cr = freshRecorder();
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();

			await startRecording(cr);

			// Emit only silence_end (no preceding silence_start)
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_end: 5.0 | silence_duration: 1.5\n'
			));

			assert.strictEqual(extractStub.callCount, 0, 'extractSegment should NOT be called when silence_end has no prior silence_start');
		});

		test('processes multiple silence cycles with correct segment boundaries', async () => {
			cr = freshRecorder();
			const extractStub = sinon.stub(cr, 'extractSegment').resolves();

			await startRecording(cr);

			// Cycle 1: speech 0-3s, silence 3-5s
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 3.0\n'
				+ '[silencedetect @ 0x7f8] silence_end: 5.0 | silence_duration: 2.0\n'
			));

			assert.strictEqual(extractStub.callCount, 1, 'Cycle 1: extractSegment should be called once');
			assert.strictEqual(extractStub.firstCall.args[0], 0, 'Cycle 1: startTime should be 0');
			assert.strictEqual(extractStub.firstCall.args[1], 3.3, 'Cycle 1: endTime should be 3.0+0.3 buffer');

			// Cycle 2: speech 5-8s, silence 8-10s
			fakeProcess.stderr.emit('data', Buffer.from(
				'[silencedetect @ 0x7f8] silence_start: 8.0\n'
				+ '[silencedetect @ 0x7f8] silence_end: 10.0 | silence_duration: 2.0\n'
			));

			assert.strictEqual(extractStub.callCount, 2, 'Cycle 2: extractSegment should be called twice total');
			assert.strictEqual(extractStub.secondCall.args[0], 5.0, 'Cycle 2: startTime should be 5.0 (lastSegmentEnd)');
			assert.strictEqual(extractStub.secondCall.args[1], 8.3, 'Cycle 2: endTime should be 8.0+0.3 buffer');

			// Stop recording — final segment should start at 10.0
			extractStub.resetHistory();
			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.strictEqual(extractStub.callCount, 1, 'Final: extractSegment should be called once for final segment');
			assert.strictEqual(extractStub.firstCall.args[0], 10.0, 'Final: startTime should be 10.0 (lastSegmentEnd after cycle 2)');
			assert.ok(extractStub.firstCall.args[1] >= 99999, 'Final: endTime should be a large number');
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

		test('emits error and stopped when ffmpeg crashes mid-recording', async () => {
			cr = freshRecorder();
			await startRecording(cr);

			const errorEvents: Error[] = [];
			const stoppedSpy = sinon.spy();
			cr.on('error', (err: Error) => errorEvents.push(err));
			cr.on('stopped', stoppedSpy);

			// Simulate ffmpeg crash: emit 'close' with code 1
			fakeProcess.emit('close', 1);

			assert.strictEqual(cr.isRecording, false, 'isRecording should be false after crash');
			assert.strictEqual(errorEvents.length, 1, 'Should emit one error event');
			assert.ok(errorEvents[0] instanceof Error);
			assert.ok(
				errorEvents[0].message.includes('unexpectedly'),
				`Error message should mention unexpected stop, got: ${errorEvents[0].message}`
			);
			assert.ok(stoppedSpy.calledOnce, 'Should emit stopped event after crash');
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

		test('rejects after 5s if process never exits even after SIGKILL', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			// Make kill() a no-op so the process never actually closes
			fakeProcess.kill = sinon.stub().returns(true);

			const stopPromise = cr.stop();
			await clock.tickAsync(5000);

			await assert.rejects(
				stopPromise,
				/Failed to stop recording.*5 seconds/
			);
		});

		test('falls back to SIGKILL when stdin is destroyed', async () => {
			cr = freshRecorder();
			sinon.stub(cr, 'extractSegment').resolves();
			await startRecording(cr);

			// Mark stdin as destroyed before stopping
			(fakeProcess.stdin as any).destroyed = true;

			const stopPromise = cr.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(
				fakeProcess.kill.calledWith('SIGKILL'),
				'Expected SIGKILL fallback when stdin is destroyed'
			);
			assert.ok(
				!fakeProcess.stdin.write.called,
				'Expected stdin.write NOT to be called when stdin is destroyed'
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

		test('dispose cleans up segment files', async () => {
			// Create a real raw PCM file and extract segments from it
			const rawPath = path.join(os.tmpdir(), `verba-test-dispose-${Date.now()}.wav`);
			const pcmBytes = 96000; // 3 seconds at 32000 bytes/sec
			const pcmBuf = Buffer.alloc(pcmBytes);
			for (let i = 0; i < pcmBytes; i += 2) {
				pcmBuf.writeInt16LE(Math.floor(Math.sin(i / 10) * 10000), i);
			}
			const hdr = Buffer.alloc(44);
			hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcmBytes, 4);
			hdr.write('WAVE', 8); hdr.write('fmt ', 12);
			hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
			hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(16000, 24);
			hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32);
			hdr.writeUInt16LE(16, 34); hdr.write('data', 36);
			hdr.writeUInt32LE(pcmBytes, 40);
			fs.writeFileSync(rawPath, Buffer.concat([hdr, pcmBuf]));

			const cr2 = new ContinuousRecorder(rawPath);
			await cr2.extractSegment(0, 1.0);
			await cr2.extractSegment(1.0, 2.0);

			// Verify segment files exist
			const seg0 = rawPath.replace(/\.wav$/, '-seg-0.wav');
			const seg1 = rawPath.replace(/\.wav$/, '-seg-1.wav');
			assert.ok(fs.existsSync(seg0), 'seg-0 should exist before dispose');
			assert.ok(fs.existsSync(seg1), 'seg-1 should exist before dispose');

			cr2.dispose();

			// All files should be cleaned up
			assert.ok(!fs.existsSync(seg0), 'seg-0 should be deleted after dispose');
			assert.ok(!fs.existsSync(seg1), 'seg-1 should be deleted after dispose');
			assert.ok(!fs.existsSync(rawPath), 'raw file should be deleted after dispose');
		});
	});
});
