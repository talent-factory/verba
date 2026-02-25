import * as assert from 'assert';
import * as sinon from 'sinon';

import { EmbeddingService } from '../../embeddingService';

function createFakeOpenAIClient() {
	return {
		embeddings: {
			create: sinon.stub(),
		},
	};
}

function createFakeSecretStorage() {
	return {
		get: sinon.stub(),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
	};
}

suite('EmbeddingService', () => {
	let service: EmbeddingService;
	let fakeClient: ReturnType<typeof createFakeOpenAIClient>;
	let secretStorage: ReturnType<typeof createFakeSecretStorage>;

	setup(() => {
		secretStorage = createFakeSecretStorage();
		secretStorage.get.resolves('sk-test-key');
		service = new EmbeddingService(secretStorage as any);
		fakeClient = createFakeOpenAIClient();
		(service as any)._client = fakeClient;
	});

	teardown(() => {
		sinon.restore();
	});

	test('embed returns vector for single text', async () => {
		fakeClient.embeddings.create.resolves({
			data: [{ embedding: [0.1, 0.2, 0.3] }],
		});

		const result = await service.embed('hello world');

		assert.deepStrictEqual(result, [0.1, 0.2, 0.3]);
		const callArgs = fakeClient.embeddings.create.firstCall.args[0];
		assert.strictEqual(callArgs.model, 'text-embedding-3-small');
	});

	test('embedBatch returns vectors for multiple texts', async () => {
		fakeClient.embeddings.create.resolves({
			data: [
				{ embedding: [0.1, 0.2] },
				{ embedding: [0.3, 0.4] },
			],
		});

		const result = await service.embedBatch(['hello', 'world']);

		assert.strictEqual(result.length, 2);
		assert.deepStrictEqual(result[0], [0.1, 0.2]);
		assert.deepStrictEqual(result[1], [0.3, 0.4]);
		assert.strictEqual(fakeClient.embeddings.create.callCount, 1);
	});

	test('embedBatch handles empty input', async () => {
		const result = await service.embedBatch([]);

		assert.strictEqual(result.length, 0);
		assert.ok(fakeClient.embeddings.create.notCalled);
	});

	test('throws descriptive error on API failure', async () => {
		fakeClient.embeddings.create.rejects(new Error('ECONNREFUSED'));

		await assert.rejects(
			() => service.embed('test'),
			/Embedding failed: ECONNREFUSED/
		);
	});

	test('clears client and key on 401', async () => {
		const authError = new Error('Invalid API key');
		(authError as any).status = 401;
		fakeClient.embeddings.create.rejects(authError);

		await assert.rejects(
			() => service.embed('test'),
			/Invalid OpenAI API key/
		);
		assert.strictEqual((service as any)._client, null);
	});
});
