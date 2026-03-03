import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

import { parseSilenceEvent, SilenceEvent, SegmentEvent, ContinuousRecorder } from '../../continuousRecorder';
import * as recorder from '../../recorder';

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
