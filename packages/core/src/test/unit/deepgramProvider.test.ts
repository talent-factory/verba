import * as assert from 'assert';
import * as sinon from 'sinon';

import {
	DeepgramProvider,
	INVALID_DEEPGRAM_API_KEY_MESSAGE,
	truncateKeyterms,
	resolveApiKey,
	API_KEY_STORAGE_KEY,
} from '../../deepgramProvider';

// Fake SecretStore matching the SecretStore interface in adapters.ts
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

suite('truncateKeyterms', () => {
	test('formats each term with a :2 boost weight', () => {
		const result = truncateKeyterms(['foo', 'bar']);
		assert.deepStrictEqual(result, ['foo:2', 'bar:2']);
	});

	test('returns an empty array for an empty glossary', () => {
		assert.deepStrictEqual(truncateKeyterms([]), []);
	});

	test('keeps every term when the estimated token budget is exactly met', () => {
		// Each 9-char term ("aaaaaaa:2") is estimated at ceil(9/3) = 3 tokens.
		// 66 terms * 3 tokens = 198 <= 200, so all 66 should survive.
		const terms = Array.from({ length: 66 }, () => 'aaaaaaa');
		const result = truncateKeyterms(terms);
		assert.strictEqual(result.length, 66);
	});

	test('drops terms once the estimated token budget would be exceeded', () => {
		const terms = Array.from({ length: 100 }, (_, i) => `term${i}`);
		const result = truncateKeyterms(terms);
		assert.ok(result.length < terms.length);
	});

	test('keeps a single term exactly at the per-term budget boundary', () => {
		// kt = term + ":2" (600 chars) → estimated = ceil(600/3) = 200 === MAX_TOKENS.
		const term = 'x'.repeat(598);
		const result = truncateKeyterms([term]);
		assert.deepStrictEqual(result, [`${term}:2`]);
	});

	test('drops a single term whose own estimated cost alone exceeds the budget', () => {
		// kt = term + ":2" (601 chars) → estimated = ceil(601/3) = 201 > MAX_TOKENS,
		// so even the very first term never gets added.
		const term = 'x'.repeat(599);
		const result = truncateKeyterms([term]);
		assert.deepStrictEqual(result, []);
	});
});

suite('resolveApiKey', () => {
	test('returns the stored key without prompting', async () => {
		const secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves('stored-key');
		const prompt = sinon.stub().resolves('prompted-key');

		const key = await resolveApiKey(secretStorage, prompt);

		assert.strictEqual(key, 'stored-key');
		assert.strictEqual(prompt.called, false);
		assert.strictEqual(secretStorage.get.firstCall.args[0], API_KEY_STORAGE_KEY);
	});

	test('prompts and persists the key when none is stored', async () => {
		const secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves(undefined);
		const prompt = sinon.stub().resolves('new-key');

		const key = await resolveApiKey(secretStorage, prompt);

		assert.strictEqual(key, 'new-key');
		assert.strictEqual(secretStorage.store.calledOnceWith(API_KEY_STORAGE_KEY, 'new-key'), true);
	});

	test('throws when the prompt is cancelled', async () => {
		const secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves(undefined);
		const prompt = sinon.stub().resolves(undefined);

		await assert.rejects(
			() => resolveApiKey(secretStorage, prompt),
			/Deepgram API key required for transcription\./
		);
		assert.strictEqual(secretStorage.store.called, false);
	});

	test('honors a custom storage key', async () => {
		const secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves(undefined);
		const prompt = sinon.stub().resolves('custom-key');

		await resolveApiKey(secretStorage, prompt, 'custom.storage.key');

		assert.strictEqual(secretStorage.get.firstCall.args[0], 'custom.storage.key');
		assert.strictEqual(secretStorage.store.firstCall.args[0], 'custom.storage.key');
	});
});

suite('DeepgramProvider.transcribe', () => {
	function makeProvider(): {
		provider: DeepgramProvider;
		secretStorage: ReturnType<typeof createFakeSecretStorage>;
		transcribeFile: sinon.SinonStub;
	} {
		const secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves('sk-deepgram');
		const readAudioFile = sinon.stub().resolves(new Uint8Array([1, 2, 3]));
		const provider = new DeepgramProvider(secretStorage as any, readAudioFile as any, sinon.stub());
		const transcribeFile = sinon.stub();
		// Inject the Deepgram SDK client so getClient() never touches @deepgram/sdk.
		(provider as any)._client = { listen: { prerecorded: { transcribeFile } } };
		return { provider, secretStorage, transcribeFile };
	}

	function okResponse(transcript: string, detectedLanguage?: string) {
		return {
			result: { results: { channels: [{ alternatives: [{ transcript }], detected_language: detectedLanguage }] } },
		};
	}

	test('returns the transcript and detected language on success (auto → multi)', async () => {
		const { provider, transcribeFile } = makeProvider();
		transcribeFile.resolves(okResponse('hello world', 'en'));

		const result = await provider.transcribe('audio.wav');

		assert.deepStrictEqual(result, { text: 'hello world', detectedLanguage: 'en' });
		const options = transcribeFile.firstCall.args[1];
		assert.strictEqual(options.language, 'multi');
		assert.strictEqual(options.detect_language, true);
	});

	test('uses a fixed language and omits detect_language when set', async () => {
		const { provider, transcribeFile } = makeProvider();
		provider.setLanguage('de');
		transcribeFile.resolves(okResponse('hallo', undefined));

		const result = await provider.transcribe('audio.wav');

		assert.strictEqual(result.text, 'hallo');
		const options = transcribeFile.firstCall.args[1];
		assert.strictEqual(options.language, 'de');
		assert.strictEqual(options.detect_language, undefined);
	});

	test('passes truncated glossary terms as keyterms', async () => {
		const { provider, transcribeFile } = makeProvider();
		transcribeFile.resolves(okResponse('hi', 'en'));

		await provider.transcribe('audio.wav', ['foo', 'bar']);

		assert.deepStrictEqual(transcribeFile.firstCall.args[1].keyterm, ['foo:2', 'bar:2']);
	});

	test('clears the key and throws a recovery message on 401', async () => {
		const { provider, secretStorage, transcribeFile } = makeProvider();
		const err: any = new Error('unauthorized');
		err.status = 401;
		transcribeFile.rejects(err);

		await assert.rejects(() => provider.transcribe('audio.wav'), /Invalid Deepgram API key/);
		assert.strictEqual(secretStorage.delete.calledOnceWith(API_KEY_STORAGE_KEY), true);
	});

	test('wraps a generic SDK error', async () => {
		const { provider, transcribeFile } = makeProvider();
		transcribeFile.rejects(new Error('network boom'));

		await assert.rejects(() => provider.transcribe('audio.wav'), /Transcription failed: network boom/);
	});

	test('throws when the response carries an error union', async () => {
		const { provider, transcribeFile } = makeProvider();
		transcribeFile.resolves({ error: { message: 'bad request' } });

		await assert.rejects(() => provider.transcribe('audio.wav'), /Transcription failed: bad request/);
	});

	test('throws when the response has no result', async () => {
		const { provider, transcribeFile } = makeProvider();
		transcribeFile.resolves({});

		await assert.rejects(() => provider.transcribe('audio.wav'), /Deepgram returned no result/);
	});

	test('propagates the no-speech error for an empty transcript', async () => {
		const { provider, transcribeFile } = makeProvider();
		transcribeFile.resolves(okResponse('', 'en'));

		await assert.rejects(() => provider.transcribe('audio.wav'), /No speech detected/);
	});
});
