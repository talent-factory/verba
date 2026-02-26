import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as child_process from 'child_process';

import { TranscriptionService } from '../../transcriptionService';

// Fake SecretStorage matching vscode.SecretStorage interface
function createFakeSecretStorage(): {
	get: sinon.SinonStub;
	store: sinon.SinonStub;
	delete: sinon.SinonStub;
	onDidChange: sinon.SinonStub;
} {
	return {
		get: sinon.stub(),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
		onDidChange: sinon.stub(),
	};
}

// Fake OpenAI client
function createFakeOpenAIClient() {
	return {
		audio: {
			transcriptions: {
				create: sinon.stub(),
			},
		},
	};
}

suite('TranscriptionService', () => {
	let service: TranscriptionService;
	let secretStorage: ReturnType<typeof createFakeSecretStorage>;
	let fakeClient: ReturnType<typeof createFakeOpenAIClient>;
	let promptApiKeyStub: sinon.SinonStub;

	setup(() => {
		secretStorage = createFakeSecretStorage();
		fakeClient = createFakeOpenAIClient();
		service = new TranscriptionService(secretStorage as any);
		// Inject the fake client to avoid real API calls
		(service as any)._client = fakeClient;
		// Stub the prompt method to control API key flow
		promptApiKeyStub = sinon.stub(service as any, 'promptForApiKey');
	});

	teardown(() => {
		sinon.restore();
	});

	test('has name "Whisper Transcription"', () => {
		assert.strictEqual(service.name, 'Whisper Transcription');
	});

	suite('process()', () => {
		test('sends WAV file to whisper-1 and returns transcript', async () => {
			secretStorage.get.resolves('sk-test-key-123');
			fakeClient.audio.transcriptions.create.resolves({ text: 'Hello world' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			const result = await service.process('/tmp/test.wav');

			assert.strictEqual(result, 'Hello world');
			assert.ok(fakeClient.audio.transcriptions.create.calledOnce);
			const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
			assert.strictEqual(callArgs.model, 'whisper-1');
			assert.strictEqual(callArgs.file, 'fake-stream');
		});

		test('prompts for API key when none is stored', async () => {
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves('sk-new-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'test' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/test.wav');

			assert.ok(promptApiKeyStub.calledOnce);
			assert.ok(secretStorage.store.calledWith('openai-api-key', 'sk-new-key'));
		});

		test('throws when user cancels API key prompt', async () => {
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves(undefined);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/OpenAI API key required/
			);
		});

		test('uses cached API key on second call', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'first' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/a.wav');
			await service.process('/tmp/b.wav');

			// secretStorage.get called twice but promptApiKeyStub never called
			assert.ok(promptApiKeyStub.notCalled);
		});

		test('throws on empty transcript', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: '' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/No speech detected/
			);
		});

		test('clears stored key, resets client, and throws on 401 authentication error', async () => {
			secretStorage.get.resolves('sk-bad-key');
			const authError = new Error('Incorrect API key provided');
			(authError as any).status = 401;
			fakeClient.audio.transcriptions.create.rejects(authError);
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Invalid OpenAI API key/
			);
			assert.ok(secretStorage.delete.calledWith('openai-api-key'));
			assert.strictEqual((service as any)._client, null, 'client should be cleared after 401');
		});

		test('throws descriptive error on network failure', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.rejects(new Error('ECONNREFUSED'));
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Transcription failed: ECONNREFUSED/
			);
		});

		test('throws silence error when transcript is only dots or ellipsis', async () => {
			secretStorage.get.resolves('sk-test-key');
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			for (const silenceText of ['...', '…', '. . .', '  ...  ', '.\n.']) {
				fakeClient.audio.transcriptions.create.resolves({ text: silenceText });
				await assert.rejects(
					() => service.process('/tmp/test.wav'),
					/No speech detected.*only silence/,
					`should reject silence text: ${JSON.stringify(silenceText)}`,
				);
			}
		});

		test('throws on whitespace-only transcript', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: '   \t  ' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/No speech detected/
			);
		});

		test('wraps non-Error thrown values in descriptive message', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.returns(Promise.reject('raw string error'));
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Transcription failed: raw string error/
			);
		});

		test('passes glossary terms as prompt parameter to Whisper', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'Visual Studio Code is great' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/test.wav', ['Visual Studio Code', 'Kubernetes']);

			const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
			assert.strictEqual(callArgs.prompt, 'Visual Studio Code, Kubernetes');
		});

		test('omits prompt parameter when glossary is empty', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'Hello world' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/test.wav', []);

			const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
			assert.strictEqual(callArgs.prompt, undefined);
		});

		test('omits prompt parameter when glossary is undefined', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'Hello world' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/test.wav');

			const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
			assert.strictEqual(callArgs.prompt, undefined);
		});
	});

	suite('provider selection', () => {
		test('defaults to openai provider', () => {
			assert.strictEqual((service as any)._provider, 'openai');
		});

		test('setProvider changes the active provider', () => {
			service.setProvider('local');
			assert.strictEqual((service as any)._provider, 'local');
		});

		test('setProvider rejects invalid provider values', () => {
			assert.throws(
				() => service.setProvider('invalid' as any),
				/Invalid provider/
			);
		});
	});

	suite('local transcription (whisper.cpp)', () => {
		let spawnStub: sinon.SinonStub;
		let spawnSyncStub: sinon.SinonStub;
		let existsSyncStub: sinon.SinonStub;

		/** Creates a fake child process that emits stdout/stderr and exits with the given code. */
		function fakeSpawn(stdout: string, stderr: string, exitCode: number | null, error?: Error) {
			const { EventEmitter } = require('events');

			const proc = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();
			proc.kill = sinon.stub();

			// Emit data after event handlers are attached (next tick), then close on following tick
			process.nextTick(() => {
				if (stdout) { proc.stdout.emit('data', Buffer.from(stdout)); }
				if (stderr) { proc.stderr.emit('data', Buffer.from(stderr)); }
				// Delay close slightly so data handlers process first
				setImmediate(() => {
					if (error) {
						proc.emit('error', error);
					} else {
						proc.emit('close', exitCode);
					}
				});
			});

			return proc;
		}

		setup(() => {
			service.setProvider('local');
			service.setModelPath('/models/ggml-base.bin');
			spawnStub = sinon.stub(child_process, 'spawn');
			spawnSyncStub = sinon.stub(child_process, 'spawnSync');
			existsSyncStub = sinon.stub(fs, 'existsSync');
		});

		test('calls whisper-cli with correct arguments', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('Hello from whisper.cpp', '', 0));

			const result = await service.process('/tmp/test.wav');

			assert.strictEqual(result, 'Hello from whisper.cpp');
			assert.ok(spawnStub.calledOnce);
			const [binary, args] = spawnStub.firstCall.args;
			assert.ok(typeof binary === 'string');
			assert.ok(args.includes('-m'));
			assert.ok(args.includes('/models/ggml-base.bin'));
			assert.ok(args.includes('-f'));
			assert.ok(args.includes('/tmp/test.wav'));
			assert.ok(args.includes('-np'));
			assert.ok(args.includes('-l'));
			assert.ok(args.includes('auto'));
		});

		test('does not require OpenAI API key for local transcription', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('Offline transcript', '', 0));

			const result = await service.process('/tmp/test.wav');

			assert.strictEqual(result, 'Offline transcript');
			assert.ok(secretStorage.get.notCalled, 'should not access secret storage');
		});

		test('passes glossary terms as --prompt to whisper-cli', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('Visual Studio Code is great', '', 0));

			await service.process('/tmp/test.wav', ['Visual Studio Code', 'Kubernetes']);

			const args = spawnStub.firstCall.args[1] as string[];
			const promptIdx = args.indexOf('--prompt');
			assert.ok(promptIdx >= 0, 'should pass --prompt flag');
			assert.strictEqual(args[promptIdx + 1], 'Visual Studio Code, Kubernetes');
		});

		test('omits --prompt when glossary is empty', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('Hello world', '', 0));

			await service.process('/tmp/test.wav', []);

			const args = spawnStub.firstCall.args[1] as string[];
			assert.ok(!args.includes('--prompt'), 'should not include --prompt');
		});

		test('throws when whisper-cli binary is not found', async () => {
			existsSyncStub.returns(false);
			spawnSyncStub.returns({ status: 1, stdout: '', stderr: '', error: undefined, pid: 0, output: [], signal: null });

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/whisper-cli not found/
			);
		});

		test('throws when model file does not exist', async () => {
			existsSyncStub.callsFake((p: string) => {
				if (typeof p === 'string' && p.includes('whisper-cli')) { return true; }
				if (typeof p === 'string' && p.includes('ggml-')) { return false; }
				return false;
			});

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Whisper model not found/
			);
		});

		test('throws when no model path is configured', async () => {
			service.setModelPath('');
			existsSyncStub.returns(true);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/No whisper model configured/
			);
		});

		test('throws descriptive error when whisper-cli exits with non-zero code', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('', 'error: failed to load model', 1));

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Local transcription failed.*failed to load model/
			);
		});

		test('throws when whisper-cli produces empty output', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('', '', 0));

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/No speech detected/
			);
		});

		test('throws when whisper-cli process fails to start', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('', '', null, new Error('ENOENT')));

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Local transcription failed.*ENOENT/
			);
		});

		test('trims whitespace from whisper-cli output', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn('  Hello world  \n', '', 0));

			const result = await service.process('/tmp/test.wav');
			assert.strictEqual(result, 'Hello world');
		});

		test('strips timestamp prefixes from whisper-cli output', async () => {
			existsSyncStub.returns(true);
			spawnStub.callsFake(() => fakeSpawn(
				'[00:00:00.000 --> 00:00:03.000]  Hello world\n[00:00:03.000 --> 00:00:05.000]  This is a test\n',
				'', 0,
			));

			const result = await service.process('/tmp/test.wav');
			assert.strictEqual(result, 'Hello world This is a test');
		});

		test('throws timeout error when transcription exceeds time limit', async () => {
			existsSyncStub.returns(true);
			// Simulate a process that is killed by the timeout (emits close with null exit code)
			// We stub spawnWhisper directly to simulate the timeout flag
			const spawnWhisperStub = sinon.stub(service as any, 'spawnWhisper').resolves({
				stdout: '', stderr: '', exitCode: null, timedOut: true,
			});

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/timed out.*Try a smaller model/
			);

			spawnWhisperStub.restore();
		});
	});

	suite('findWhisperCpp()', () => {
		let existsSyncStub: sinon.SinonStub;

		setup(() => {
			existsSyncStub = sinon.stub(fs, 'existsSync');
		});

		test('finds whisper-cli at /opt/homebrew/bin/whisper-cli on macOS', () => {
			existsSyncStub.callsFake((p: string) => p === '/opt/homebrew/bin/whisper-cli');
			const result = (service as any).findWhisperCpp();
			assert.strictEqual(result, '/opt/homebrew/bin/whisper-cli');
		});

		test('finds whisper-cli at /usr/local/bin/whisper-cli on macOS', () => {
			existsSyncStub.callsFake((p: string) => p === '/usr/local/bin/whisper-cli');
			const result = (service as any).findWhisperCpp();
			assert.strictEqual(result, '/usr/local/bin/whisper-cli');
		});

		test('falls back to which command when binary is not at known paths', () => {
			existsSyncStub.returns(false);
			sinon.stub(child_process, 'spawnSync').returns({
				status: 0, stdout: '/custom/path/whisper-cli\n', stderr: '',
				error: undefined, pid: 0, output: [], signal: null,
			});
			const result = (service as any).findWhisperCpp();
			assert.strictEqual(result, '/custom/path/whisper-cli');
		});

		test('returns null when whisper-cli is not installed', () => {
			existsSyncStub.returns(false);
			sinon.stub(child_process, 'spawnSync').returns({
				status: 1, stdout: '', stderr: '', error: undefined,
				pid: 0, output: [], signal: null,
			});
			const result = (service as any).findWhisperCpp();
			assert.strictEqual(result, null);
		});

		test('returns null when which command throws', () => {
			existsSyncStub.returns(false);
			sinon.stub(child_process, 'spawnSync').throws(new Error('ENOENT'));
			const result = (service as any).findWhisperCpp();
			assert.strictEqual(result, null);
		});
	});
});
