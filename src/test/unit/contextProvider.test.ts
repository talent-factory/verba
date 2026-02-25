import * as assert from 'assert';
import * as sinon from 'sinon';

import { ContextProvider } from '../../contextProvider';

suite('ContextProvider', () => {
	teardown(() => {
		sinon.restore();
	});

	test('search formats grepai results as context strings when grepai is active', async () => {
		const fakeGrepai = {
			search: sinon.stub().returns([
				{ file: 'src/auth.ts', content: 'function login() {}' },
			]),
		};
		const provider = new ContextProvider({ type: 'grepai', grepai: fakeGrepai as any });

		const results = await provider.search('authentication', 5);

		assert.strictEqual(results.length, 1);
		assert.ok(results[0].includes('src/auth.ts'));
		assert.ok(results[0].includes('function login'));
	});

	test('search uses indexer when type is openai', async () => {
		const fakeEmbedding = { embed: sinon.stub().resolves([0.1, 0.2]) };
		const fakeIndexer = {
			search: sinon.stub().returns([
				{ file: 'b.ts', range: '1-10', hash: 'x', content: 'class Foo {}', vector: [0.1, 0.2] },
			]),
		};
		const provider = new ContextProvider({
			type: 'openai',
			embeddingService: fakeEmbedding as any,
			indexer: fakeIndexer as any,
		});

		const results = await provider.search('class definition', 5);

		assert.strictEqual(results.length, 1);
		assert.ok(results[0].includes('b.ts'));
		assert.ok(results[0].includes('class Foo'));
		assert.ok(fakeEmbedding.embed.calledWith('class definition'));
	});

	test('search returns empty array when no provider configured', async () => {
		const provider = new ContextProvider({ type: 'none' });
		const results = await provider.search('test', 5);
		assert.strictEqual(results.length, 0);
	});

	test('isAvailable returns true for grepai type', () => {
		const fakeGrepai = { search: sinon.stub() };
		const provider = new ContextProvider({ type: 'grepai', grepai: fakeGrepai as any });
		assert.strictEqual(provider.isAvailable(), true);
	});

	test('isAvailable returns true for openai type', () => {
		const provider = new ContextProvider({
			type: 'openai',
			embeddingService: {} as any,
			indexer: {} as any,
		});
		assert.strictEqual(provider.isAvailable(), true);
	});

	test('isAvailable returns false for none type', () => {
		const provider = new ContextProvider({ type: 'none' });
		assert.strictEqual(provider.isAvailable(), false);
	});

	test('providerType returns the configured type', () => {
		const provider = new ContextProvider({ type: 'none' });
		assert.strictEqual(provider.providerType, 'none');
	});
});
