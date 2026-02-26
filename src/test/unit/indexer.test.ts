import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { Indexer, chunkFileContent } from '../../indexer';

suite('chunkFileContent', () => {
	test('splits file into line-based chunks', () => {
		const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
		const chunks = chunkFileContent('test.ts', content, 50);
		assert.ok(chunks.length > 1, 'should produce multiple chunks');
		assert.ok(chunks.every(c => c.file === 'test.ts'));
		assert.ok(chunks.every(c => c.content.length > 0));
		assert.ok(chunks.every(c => c.range.match(/^\d+-\d+$/)));
	});

	test('returns single chunk for small files', () => {
		const content = 'const x = 1;\nconst y = 2;';
		const chunks = chunkFileContent('small.ts', content, 50);
		assert.strictEqual(chunks.length, 1);
		assert.strictEqual(chunks[0].range, '1-2');
	});

	test('returns empty array for empty content', () => {
		const chunks = chunkFileContent('empty.ts', '', 50);
		assert.strictEqual(chunks.length, 0);
	});
});

suite('Indexer', () => {
	let tmpDir: string;
	let embedStub: sinon.SinonStub;
	let indexer: Indexer;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verba-indexer-'));
		embedStub = sinon.stub().resolves([[0.1, 0.2, 0.3]]);
		indexer = new Indexer(
			tmpDir,
			path.join(tmpDir, '.verba'),
			{ embedBatch: embedStub } as any,
		);
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		sinon.restore();
	});

	test('indexFile indexes a single file', async () => {
		const filePath = path.join(tmpDir, 'hello.ts');
		fs.writeFileSync(filePath, 'export function hello() { return "hi"; }');

		const count = await indexer.indexFile('hello.ts');

		assert.ok(count > 0, 'should index at least one chunk');
		assert.ok(embedStub.calledOnce);
	});

	test('indexFile skips unchanged files (same hash)', async () => {
		const filePath = path.join(tmpDir, 'stable.ts');
		fs.writeFileSync(filePath, 'const x = 1;');

		await indexer.indexFile('stable.ts');
		embedStub.resetHistory();

		await indexer.indexFile('stable.ts');

		assert.ok(embedStub.notCalled, 'should not re-embed unchanged file');
	});

	test('indexFile re-indexes when file content changes', async () => {
		const filePath = path.join(tmpDir, 'changing.ts');
		fs.writeFileSync(filePath, 'const x = 1;');
		await indexer.indexFile('changing.ts');

		fs.writeFileSync(filePath, 'const x = 2;');
		embedStub.resetHistory();
		embedStub.resolves([[0.4, 0.5, 0.6]]);

		const count = await indexer.indexFile('changing.ts');

		assert.ok(count > 0);
		assert.ok(embedStub.calledOnce);
	});

	test('getFileHashes returns tracked file hashes', async () => {
		const filePath = path.join(tmpDir, 'tracked.ts');
		fs.writeFileSync(filePath, 'const x = 1;');
		await indexer.indexFile('tracked.ts');

		const hashes = indexer.getFileHashes();
		assert.ok(hashes.has('tracked.ts'));
	});

	test('indexAll indexes multiple files and calls progress callback', async () => {
		fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const a = 1;');
		fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'const b = 2;');
		embedStub.resolves([[0.1, 0.2, 0.3]]);

		const progressCalls: [number, number][] = [];
		const totalChunks = await indexer.indexAll(['a.ts', 'b.ts'], (done, total) => {
			progressCalls.push([done, total]);
		});

		assert.ok(totalChunks > 0);
		assert.deepStrictEqual(progressCalls, [[1, 2], [2, 2]]);
	});

	test('indexFile returns 0 for empty file without calling embedBatch', async () => {
		fs.writeFileSync(path.join(tmpDir, 'empty.ts'), '');

		const count = await indexer.indexFile('empty.ts');

		assert.strictEqual(count, 0);
		assert.ok(embedStub.notCalled);
		assert.ok(indexer.getFileHashes().has('empty.ts'), 'should still track the hash');
	});

	test('search delegates to internal vector store', async () => {
		fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export function hello() {}');
		embedStub.resolves([[1, 0, 0]]);
		await indexer.indexFile('hello.ts');

		const results = indexer.search([1, 0, 0], 5);

		assert.ok(results.length > 0);
		assert.ok(results[0].content.includes('hello'));
	});
});
