import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { VectorStore, IndexChunk } from '../../vectorStore';

suite('VectorStore', () => {
	let store: VectorStore;
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verba-test-'));
		store = new VectorStore(tmpDir);
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('starts empty', () => {
		assert.strictEqual(store.size, 0);
	});

	test('upsert adds chunks', () => {
		store.upsert([
			{ file: 'a.ts', range: '1-10', hash: 'abc', content: 'function foo() {}', vector: [1, 0, 0] },
		]);
		assert.strictEqual(store.size, 1);
	});

	test('upsert replaces chunks with same file+range', () => {
		store.upsert([
			{ file: 'a.ts', range: '1-10', hash: 'abc', content: 'old', vector: [1, 0, 0] },
		]);
		store.upsert([
			{ file: 'a.ts', range: '1-10', hash: 'def', content: 'new', vector: [0, 1, 0] },
		]);
		assert.strictEqual(store.size, 1);
		const results = store.search([0, 1, 0], 1);
		assert.strictEqual(results[0].content, 'new');
	});

	test('removeByFile removes all chunks for a file', () => {
		store.upsert([
			{ file: 'a.ts', range: '1-10', hash: 'abc', content: 'x', vector: [1, 0, 0] },
			{ file: 'a.ts', range: '11-20', hash: 'def', content: 'y', vector: [0, 1, 0] },
			{ file: 'b.ts', range: '1-5', hash: 'ghi', content: 'z', vector: [0, 0, 1] },
		]);
		store.removeByFile('a.ts');
		assert.strictEqual(store.size, 1);
	});

	test('search returns top-k by cosine similarity', () => {
		store.upsert([
			{ file: 'a.ts', range: '1-10', hash: 'a', content: 'exact match', vector: [1, 0, 0] },
			{ file: 'b.ts', range: '1-10', hash: 'b', content: 'orthogonal', vector: [0, 1, 0] },
			{ file: 'c.ts', range: '1-10', hash: 'c', content: 'partial', vector: [0.7, 0.7, 0] },
		]);
		const results = store.search([1, 0, 0], 2);
		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].content, 'exact match');
		assert.strictEqual(results[1].content, 'partial');
	});

	test('search returns empty array when store is empty', () => {
		const results = store.search([1, 0, 0], 5);
		assert.strictEqual(results.length, 0);
	});

	test('save and load round-trip preserves data', () => {
		store.upsert([
			{ file: 'a.ts', range: '1-10', hash: 'abc', content: 'hello', vector: [1, 0, 0] },
			{ file: 'b.ts', range: '5-15', hash: 'def', content: 'world', vector: [0, 1, 0] },
		]);
		store.save();

		const loaded = new VectorStore(tmpDir);
		loaded.load();
		assert.strictEqual(loaded.size, 2);
		const results = loaded.search([1, 0, 0], 1);
		assert.strictEqual(results[0].content, 'hello');
	});

	test('load does nothing when no index file exists', () => {
		store.load();
		assert.strictEqual(store.size, 0);
	});
});
