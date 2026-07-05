import * as assert from 'assert';
import * as sinon from 'sinon';

import { truncateKeyterms, resolveApiKey, API_KEY_STORAGE_KEY } from '../../deepgramProvider';

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
