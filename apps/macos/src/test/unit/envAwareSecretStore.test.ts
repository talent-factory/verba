import * as assert from 'assert';
import * as sinon from 'sinon';

import { EnvAwareSecretStore } from '../../adapters/envAwareSecretStore';

function createFakeInner(): {
	get: sinon.SinonStub;
	store: sinon.SinonStub;
	delete: sinon.SinonStub;
} {
	return {
		get: sinon.stub().resolves(undefined),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
	};
}

suite('EnvAwareSecretStore', () => {
	let inner: ReturnType<typeof createFakeInner>;

	setup(() => {
		inner = createFakeInner();
	});

	test('returns the env value without consulting the keychain (env precedence)', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_ANTHROPIC_API_KEY').resolves(undefined);
		readEnv.withArgs('ANTHROPIC_API_KEY').resolves('env-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'env-key');
		assert.strictEqual(inner.get.called, false);
	});

	test('prefers the VERBA_-prefixed name over the SDK-standard name', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_DEEPGRAM_API_KEY').resolves('verba-pref');
		readEnv.withArgs('DEEPGRAM_API_KEY').resolves('sdk-std');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('verba.deepgramApiKey');

		assert.strictEqual(result, 'verba-pref');
		assert.strictEqual(readEnv.calledWith('DEEPGRAM_API_KEY'), false);
	});

	test('falls back to the keychain when no env var is set', async () => {
		const readEnv = sinon.stub().resolves(undefined);
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'keychain-key');
	});

	test('delegates straight to the keychain for an unmapped storage key', async () => {
		const readEnv = sinon.stub().resolves('should-not-be-used');
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('some.other.key');

		assert.strictEqual(result, 'keychain-key');
		assert.strictEqual(readEnv.called, false);
	});

	test('falls through to the keychain when readEnv throws', async () => {
		const readEnv = sinon.stub().rejects(new Error('ipc failed'));
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'keychain-key');
	});

	test('treats a blank env value as unset', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_ANTHROPIC_API_KEY').resolves('   ');
		readEnv.withArgs('ANTHROPIC_API_KEY').resolves(undefined);
		inner.get.resolves('keychain-key');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'keychain-key');
	});

	test('trims a padded env value before returning it', async () => {
		const readEnv = sinon.stub();
		readEnv.withArgs('VERBA_ANTHROPIC_API_KEY').resolves(undefined);
		readEnv.withArgs('ANTHROPIC_API_KEY').resolves('  env-key  ');
		const store = new EnvAwareSecretStore(inner, readEnv);

		const result = await store.get('anthropic-api-key');

		assert.strictEqual(result, 'env-key');
	});

	test('store and delete delegate verbatim to the wrapped store', async () => {
		const store = new EnvAwareSecretStore(inner, sinon.stub().resolves(undefined));

		await store.store('k', 'v');
		await store.delete('k');

		assert.strictEqual(inner.store.calledOnceWith('k', 'v'), true);
		assert.strictEqual(inner.delete.calledOnceWith('k'), true);
	});
});
