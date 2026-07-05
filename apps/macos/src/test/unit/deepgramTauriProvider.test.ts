import * as assert from 'assert';
import * as sinon from 'sinon';

import { DeepgramTauriProvider } from '../../deepgramTauriProvider';

// Fake SecretStore matching the SecretStore interface in @verba/core's adapters.ts
function createFakeSecretStorage(): {
	get: sinon.SinonStub;
	store: sinon.SinonStub;
	delete: sinon.SinonStub;
} {
	return {
		get: sinon.stub(),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
	};
}

suite('DeepgramTauriProvider', () => {
	let secretStorage: ReturnType<typeof createFakeSecretStorage>;
	let promptForApiKey: sinon.SinonStub;
	let invoke: sinon.SinonStub;
	let provider: DeepgramTauriProvider;

	setup(() => {
		secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves('stored-key');
		promptForApiKey = sinon.stub().resolves('prompted-key');
		invoke = sinon.stub();
		provider = new DeepgramTauriProvider(secretStorage, promptForApiKey, invoke);
	});

	test('transcribes successfully and passes through the stored API key', async () => {
		invoke.resolves({ text: 'hello world', detectedLanguage: 'en' });

		const result = await provider.transcribe('/tmp/rec.wav');

		assert.deepStrictEqual(result, { text: 'hello world', detectedLanguage: 'en' });
		assert.strictEqual(invoke.firstCall.args[0], 'deepgram_transcribe');
		assert.strictEqual(invoke.firstCall.args[1].apiKey, 'stored-key');
		assert.strictEqual(invoke.firstCall.args[1].audioPath, '/tmp/rec.wav');
	});

	test('truncates and forwards glossary terms as keyterms', async () => {
		invoke.resolves({ text: 'hi' });

		await provider.transcribe('/tmp/rec.wav', ['alpha', 'beta']);

		assert.deepStrictEqual(invoke.firstCall.args[1].keyterms, ['alpha:2', 'beta:2']);
	});

	test('sends no keyterms when no glossary is provided', async () => {
		invoke.resolves({ text: 'hi' });

		await provider.transcribe('/tmp/rec.wav');

		assert.deepStrictEqual(invoke.firstCall.args[1].keyterms, []);
	});

	test('clears the stored key and rethrows a friendly message when the sentinel arrives as an Error', async () => {
		// Keychain-sourced key: after delete, nothing resolves → generic message.
		secretStorage.get.onFirstCall().resolves('stored-key');
		secretStorage.get.resolves(undefined);
		invoke.rejects(new Error('deepgram_unauthorized'));

		await assert.rejects(
			() => provider.transcribe('/tmp/rec.wav'),
			/Invalid Deepgram API key\. It has been removed/
		);
		assert.strictEqual(secretStorage.delete.calledOnceWith('verba.deepgramApiKey'), true);
	});

	test('clears the stored key when the raw rejection value is the bare sentinel string', async () => {
		secretStorage.get.onFirstCall().resolves('stored-key');
		secretStorage.get.resolves(undefined);
		invoke.callsFake(() => Promise.reject('deepgram_unauthorized'));

		await assert.rejects(
			() => provider.transcribe('/tmp/rec.wav'),
			/Invalid Deepgram API key\. It has been removed/
		);
		assert.strictEqual(secretStorage.delete.calledOnceWith('verba.deepgramApiKey'), true);
	});

	test('reports an env-pinned key distinctly when a key still resolves after delete', async () => {
		// A bad key sourced from the environment survives delete (which only
		// clears the Keychain), so the generic "removed / will re-prompt" message
		// would be misleading — the user must fix the env var instead.
		secretStorage.get.resolves('bad-env-key');
		invoke.rejects(new Error('deepgram_unauthorized'));

		await assert.rejects(
			() => provider.transcribe('/tmp/rec.wav'),
			/environment \(VERBA_DEEPGRAM_API_KEY \/ DEEPGRAM_API_KEY\) is invalid/
		);
		assert.strictEqual(secretStorage.delete.calledOnceWith('verba.deepgramApiKey'), true);
	});

	test('falls back to the generic message when the store cannot be probed after delete', async () => {
		secretStorage.get.onFirstCall().resolves('stored-key');
		secretStorage.get.rejects(new Error('keychain unavailable'));
		invoke.rejects(new Error('deepgram_unauthorized'));

		await assert.rejects(
			() => provider.transcribe('/tmp/rec.wav'),
			/Invalid Deepgram API key\. It has been removed/
		);
	});

	test('does not clear the stored key for a non-sentinel error', async () => {
		invoke.rejects(new Error('network down'));

		await assert.rejects(() => provider.transcribe('/tmp/rec.wav'), /Transcription failed: network down/);
		assert.strictEqual(secretStorage.delete.called, false);
	});

	test('does not double-prefix an already-prefixed error message', async () => {
		invoke.rejects(new Error('Transcription failed: could not read recording'));

		await assert.rejects(
			() => provider.transcribe('/tmp/rec.wav'),
			/^Error: Transcription failed: could not read recording$/
		);
	});

	test('prompts for and stores a new key when none is stored', async () => {
		secretStorage.get.resolves(undefined);
		invoke.resolves({ text: 'hi' });

		await provider.transcribe('/tmp/rec.wav');

		assert.strictEqual(promptForApiKey.called, true);
		assert.strictEqual(secretStorage.store.calledOnceWith('verba.deepgramApiKey', 'prompted-key'), true);
		assert.strictEqual(invoke.firstCall.args[1].apiKey, 'prompted-key');
	});

	test('throws without invoking the command when the key prompt is cancelled', async () => {
		secretStorage.get.resolves(undefined);
		promptForApiKey.resolves(undefined);

		await assert.rejects(() => provider.transcribe('/tmp/rec.wav'), /Deepgram API key required for transcription\./);
		assert.strictEqual(invoke.called, false);
	});

	test('rejects an empty transcript via validateTranscript', async () => {
		invoke.resolves({ text: '' });

		await assert.rejects(() => provider.transcribe('/tmp/rec.wav'), /No speech detected in recording\./);
	});

	test('passes the default language "multi" in the transcribe request', async () => {
		invoke.resolves({ text: 'hi' });
		await provider.transcribe('/tmp/rec.wav');
		assert.strictEqual(invoke.firstCall.args[1].language, 'multi');
	});

	test('passes a configured language in the transcribe request', async () => {
		invoke.resolves({ text: 'hi' });
		const deProvider = new DeepgramTauriProvider(secretStorage, promptForApiKey, invoke, 'de');
		await deProvider.transcribe('/tmp/rec.wav');
		assert.strictEqual(invoke.firstCall.args[1].language, 'de');
	});

	test('setLanguage changes the language used by the next transcribe', async () => {
		invoke.resolves({ text: 'hi' });
		provider.setLanguage('de');
		await provider.transcribe('/tmp/rec.wav');
		assert.strictEqual(invoke.firstCall.args[1].language, 'de');
	});
});
