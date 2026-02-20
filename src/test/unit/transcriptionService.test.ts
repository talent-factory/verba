import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';

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

		test('clears stored key and throws on 401 authentication error', async () => {
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
	});
});
