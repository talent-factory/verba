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

	test('rejects a pre-aborted signal without invoking the command', async () => {
		const ac = new AbortController();
		ac.abort();

		await assert.rejects(
			() => provider.transcribe('/tmp/rec.wav', undefined, ac.signal),
			(err: Error) => err.name === 'AbortError',
		);
		assert.strictEqual(invoke.called, false);
	});

	test('bridges a mid-flight abort to cancel_request with the same requestId', async () => {
		// Mirrors the Anthropic path (TF-521): the controller's withTranscribeTimeout
		// aborts the signal on a stall, and the provider must fire cancel_request so
		// the native deepgram_transcribe reqwest is stopped instead of running to the
		// 30s timeout and still billing Deepgram.
		const ac = new AbortController();
		let capturedRequestId: string | undefined;
		let resolveInvoke: (v: { text: string; detectedLanguage?: string }) => void = () => {};
		invoke.withArgs('deepgram_transcribe').callsFake((_cmd: string, args: { requestId?: string }) => {
			capturedRequestId = args.requestId;
			return new Promise((resolve) => { resolveInvoke = resolve as typeof resolveInvoke; });
		});
		invoke.withArgs('cancel_request').resolves(undefined);

		const p = provider.transcribe('/tmp/rec.wav', undefined, ac.signal);
		await Promise.resolve(); // resolveApiKey + reach the deepgram_transcribe call
		await Promise.resolve();
		assert.ok(capturedRequestId, 'a requestId was minted and sent to deepgram_transcribe');

		ac.abort();
		await Promise.resolve();

		const cancelCall = invoke.getCalls().find((c) => c.args[0] === 'cancel_request');
		assert.ok(cancelCall, 'cancel_request was invoked on abort');
		assert.strictEqual((cancelCall!.args[1] as { requestId: string }).requestId, capturedRequestId);

		resolveInvoke({ text: 'hello world', detectedLanguage: 'en' });
		await p;
	});
});
