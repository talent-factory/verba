import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';
import { FfmpegRecorder } from '../../recorder';

interface FakeChildProcess extends EventEmitter {
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

function createFakeProcess(): FakeChildProcess {
	const proc = new EventEmitter() as FakeChildProcess;
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
	proc.pid = 12345;
	return proc;
}

suite('FfmpegRecorder', () => {
	let recorder: FfmpegRecorder;
	let fakeProcess: FakeChildProcess;
	let clock: sinon.SinonFakeTimers;

	setup(() => {
		recorder = new FfmpegRecorder();
		fakeProcess = createFakeProcess();
		clock = sinon.useFakeTimers();

		sinon.stub(child_process, 'spawn').returns(
			fakeProcess as unknown as child_process.ChildProcess
		);
		sinon.stub(fs, 'existsSync').callsFake(
			(p) => p === '/opt/homebrew/bin/ffmpeg'
		);
	});

	teardown(() => {
		clock.restore();
		sinon.restore();
	});

	async function startRecording(): Promise<void> {
		const startPromise = recorder.start();
		await clock.tickAsync(500);
		await startPromise;
	}

	suite('start()', () => {
		test('should throw when already recording', async () => {
			await startRecording();
			await assert.rejects(
				() => recorder.start(),
				/Recording already in progress/
			);
		});

		test('should throw on unsupported platform', async () => {
			const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
			Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
			try {
				await assert.rejects(
					() => recorder.start(),
					/Unsupported platform: freebsd/
				);
			} finally {
				if (originalDescriptor) {
					Object.defineProperty(process, 'platform', originalDescriptor);
				}
			}
		});

		test('should use avfoundation input on macOS', async () => {
			await startRecording();

			const spawnStub = child_process.spawn as sinon.SinonStub;
			const args = spawnStub.firstCall.args[1] as string[];
			assert.ok(args.includes('avfoundation'), 'Expected spawn args to include avfoundation');
			assert.ok(args.includes(':default'), 'Expected spawn args to include :default');
		});

		test('should use pulse input on Linux', async () => {
			const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
			Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

			(fs.existsSync as sinon.SinonStub).callsFake(
				(p: fs.PathLike) => p === '/usr/bin/ffmpeg'
			);

			try {
				const startPromise = recorder.start();
				await clock.tickAsync(500);
				await startPromise;

				const spawnStub = child_process.spawn as sinon.SinonStub;
				const args = spawnStub.firstCall.args[1] as string[];
				assert.ok(args.includes('pulse'), 'Expected spawn args to include pulse');
				assert.ok(args.includes('default'), 'Expected spawn args to include default');
			} finally {
				if (originalDescriptor) {
					Object.defineProperty(process, 'platform', originalDescriptor);
				}
			}
		});

		test('should throw when ffmpeg is not found', async () => {
			(fs.existsSync as sinon.SinonStub).returns(false);
			sinon.stub(child_process, 'execSync').throws(new Error('not found'));

			await assert.rejects(
				() => recorder.start(),
				/ffmpeg not found/
			);
		});

		test('should resolve after 500ms when process is alive', async () => {
			const startPromise = recorder.start();
			assert.strictEqual(recorder.isRecording, false);

			await clock.tickAsync(500);
			await startPromise;

			assert.strictEqual(recorder.isRecording, true);
		});

		test('should reject when process emits error before timeout', async () => {
			const startPromise = recorder.start();
			fakeProcess.emit('error', new Error('spawn ENOENT'));

			await assert.rejects(
				startPromise,
				/ffmpeg failed to start: spawn ENOENT/
			);
		});

		test('should reject with access denied on close code 1', async () => {
			const startPromise = recorder.start();
			fakeProcess.emit('close', 1);

			await assert.rejects(
				startPromise,
				/Microphone access denied/
			);
		});

		test('should reject with unexpected exit on other close codes', async () => {
			const startPromise = recorder.start();
			fakeProcess.emit('close', 137);

			await assert.rejects(
				startPromise,
				/exited unexpectedly with code 137/
			);
		});

		test('should set outputPath in temp directory with timestamp', async () => {
			await startRecording();
			const tmpDir = os.tmpdir();
			assert.ok(
				recorder.outputPath.startsWith(tmpDir),
				`Expected path to start with ${tmpDir}, got ${recorder.outputPath}`
			);
			assert.ok(recorder.outputPath.includes('verba-recording-'));
			assert.ok(recorder.outputPath.endsWith('.wav'));
		});

		test('should call onUnexpectedStop when process dies during recording', async () => {
			const unexpectedStopSpy = sinon.spy();
			recorder.onUnexpectedStop = unexpectedStopSpy;

			await startRecording();
			assert.strictEqual(recorder.isRecording, true);

			fakeProcess.emit('close', null);

			assert.strictEqual(unexpectedStopSpy.calledOnce, true);
			assert.ok(unexpectedStopSpy.firstCall.args[0] instanceof Error);
			assert.ok(
				unexpectedStopSpy.firstCall.args[0].message.includes('stopped unexpectedly')
			);
			assert.strictEqual(recorder.isRecording, false);
		});
	});

	suite('stop()', () => {
		test('should throw when not recording', async () => {
			await assert.rejects(
				() => recorder.stop(),
				/No recording in progress/
			);
		});

		test('should send q to stdin', async () => {
			await startRecording();
			sinon.stub(fs, 'statSync').returns({ size: 1000 } as fs.Stats);

			const stopPromise = recorder.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(
				fakeProcess.stdin.write.calledWith('q', sinon.match.func),
				'Expected stdin.write to be called with "q"'
			);
		});

		test('should resolve with outputPath when file is valid', async () => {
			await startRecording();
			sinon.stub(fs, 'statSync').returns({ size: 1000 } as fs.Stats);

			const stopPromise = recorder.stop();
			fakeProcess.emit('close', 0);
			const result = await stopPromise;

			assert.strictEqual(result, recorder.outputPath);
		});

		test('should reject when file is empty (WAV header only)', async () => {
			await startRecording();
			sinon.stub(fs, 'statSync').returns({ size: 44 } as fs.Stats);

			const stopPromise = recorder.stop();
			fakeProcess.emit('close', 0);

			await assert.rejects(stopPromise, /Recording is empty/);
		});

		test('should reject when file does not exist', async () => {
			await startRecording();
			const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
			enoent.code = 'ENOENT';
			sinon.stub(fs, 'statSync').throws(enoent);

			const stopPromise = recorder.stop();
			fakeProcess.emit('close', 0);

			await assert.rejects(stopPromise, /Recording file was not created/);
		});

		test('should reject with detail when file access fails with non-ENOENT error', async () => {
			await startRecording();
			const eacces = new Error('permission denied') as NodeJS.ErrnoException;
			eacces.code = 'EACCES';
			sinon.stub(fs, 'statSync').throws(eacces);

			const stopPromise = recorder.stop();
			fakeProcess.emit('close', 0);

			await assert.rejects(stopPromise, /Cannot access recording file: permission denied/);
		});

		test('should send SIGKILL after 3s if process does not exit', async () => {
			await startRecording();

			recorder.stop();
			await clock.tickAsync(3000);

			assert.ok(
				fakeProcess.kill.calledWith('SIGKILL'),
				'Expected process.kill("SIGKILL") after 3s timeout'
			);
		});

		test('should reject after 5s if process never exits', async () => {
			await startRecording();
			fakeProcess.kill = sinon.stub(); // prevent kill from setting killed=true

			const stopPromise = recorder.stop();
			await clock.tickAsync(5000);

			await assert.rejects(stopPromise, /did not exit within 5 seconds/);
		});

		test('should fall back to SIGKILL when stdin.write fails', async () => {
			await startRecording();
			fakeProcess.stdin.write = sinon.stub().callsFake(
				(_data: string, cb?: (err?: Error | null) => void) => {
					if (cb) { cb(new Error('EPIPE')); }
					return true;
				}
			);
			sinon.stub(fs, 'statSync').returns({ size: 1000 } as fs.Stats);

			const stopPromise = recorder.stop();
			// SIGKILL from write error triggers close
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(
				fakeProcess.kill.calledWith('SIGKILL'),
				'Expected SIGKILL fallback when stdin.write fails'
			);
		});

		test('should fall back to SIGKILL when stdin is destroyed', async () => {
			await startRecording();
			fakeProcess.stdin.destroyed = true;
			sinon.stub(fs, 'statSync').returns({ size: 1000 } as fs.Stats);

			const stopPromise = recorder.stop();
			fakeProcess.emit('close', 0);
			await stopPromise;

			assert.ok(
				fakeProcess.kill.calledWith('SIGKILL'),
				'Expected SIGKILL when stdin.destroyed is true'
			);
		});
	});

	suite('dispose()', () => {
		test('should kill process and delete temp file', async () => {
			await startRecording();
			const outputPath = recorder.outputPath;
			const unlinkStub = sinon.stub(fs, 'unlinkSync');

			recorder.dispose();

			assert.ok(fakeProcess.kill.calledWith('SIGKILL'));
			assert.ok(unlinkStub.calledWith(outputPath));
			assert.strictEqual(recorder.isRecording, false);
		});

		test('should be safe to call when not recording', () => {
			assert.doesNotThrow(() => recorder.dispose());
		});

		test('should not throw when unlinkSync fails', async () => {
			await startRecording();
			sinon.stub(fs, 'unlinkSync').throws(new Error('EPERM'));

			assert.doesNotThrow(() => recorder.dispose());
		});

		test('should not throw when process.kill throws ESRCH', async () => {
			await startRecording();
			fakeProcess.kill = sinon.stub().throws(new Error('ESRCH'));
			sinon.stub(fs, 'unlinkSync');

			assert.doesNotThrow(() => recorder.dispose());
			assert.strictEqual(recorder.isRecording, false);
		});
	});
});
