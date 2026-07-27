import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as fs from 'fs';

import { GrepaiProvider, parseGrepaiOutput } from '../../grepaiProvider';

suite('parseGrepaiOutput', () => {
	test('parses grepai --json results into file/content', () => {
		const output = JSON.stringify([
			{ file_path: 'src/auth.ts', start_line: 10, end_line: 11, score: 0.6, content: 'File: src/auth.ts\n\nfunction login() { return true; }' },
			{ file_path: 'src/session.ts', start_line: 5, end_line: 5, score: 0.5, content: 'class Session {}' },
		]);

		const results = parseGrepaiOutput(output);

		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].file, 'src/auth.ts');
		assert.ok(results[0].content.includes('function login'));
		// grepai's redundant "File: <path>" header is stripped
		assert.ok(!results[0].content.startsWith('File:'));
		assert.strictEqual(results[1].file, 'src/session.ts');
		assert.strictEqual(results[1].content, 'class Session {}');
	});

	test('returns empty array for empty or non-JSON output', () => {
		assert.strictEqual(parseGrepaiOutput('').length, 0);
		assert.strictEqual(parseGrepaiOutput('\n').length, 0);
		// the human box format is not JSON → nothing (the bug this fix addresses)
		assert.strictEqual(parseGrepaiOutput('Found 3 results for: "x"').length, 0);
		assert.strictEqual(parseGrepaiOutput('[]').length, 0);
		assert.strictEqual(parseGrepaiOutput('{"not":"an array"}').length, 0);
	});
});

suite('GrepaiProvider', () => {
	let spawnSyncStub: sinon.SinonStub;
	let existsSyncStub: sinon.SinonStub;

	setup(() => {
		spawnSyncStub = sinon.stub(child_process, 'spawnSync');
		existsSyncStub = sinon.stub(fs, 'existsSync');
	});

	teardown(() => {
		sinon.restore();
	});

	test('isAvailable returns true when .grepai dir exists and grepai is found', () => {
		existsSyncStub.returns(true);
		spawnSyncStub.returns({ status: 0, stdout: '/usr/local/bin/grepai\n', error: undefined });
		assert.strictEqual(GrepaiProvider.isAvailable('/workspace'), true);
	});

	test('isAvailable returns false when .grepai dir does not exist', () => {
		existsSyncStub.returns(false);
		assert.strictEqual(GrepaiProvider.isAvailable('/workspace'), false);
		assert.ok(spawnSyncStub.notCalled, 'should not check CLI when .grepai dir missing');
	});

	test('isAvailable returns false when .grepai exists but grepai CLI is not found', () => {
		existsSyncStub.returns(true);
		spawnSyncStub.returns({ status: 1, stdout: '', error: new Error('not found') });
		assert.strictEqual(GrepaiProvider.isAvailable('/workspace'), false);
	});

	test('search calls grepai search CLI with --json and returns results', () => {
		const provider = new GrepaiProvider('/workspace');
		spawnSyncStub.returns({
			status: 0,
			stdout: JSON.stringify([
				{ file_path: 'src/auth.ts', start_line: 10, end_line: 10, score: 0.6, content: 'function login() {}' },
			]),
			stderr: '',
			error: undefined,
		});

		const results = provider.search('authentication logic', 5);

		assert.ok(spawnSyncStub.calledOnce);
		const args = spawnSyncStub.firstCall.args;
		assert.strictEqual(args[0], 'grepai');
		assert.ok(args[1].includes('search'));
		assert.ok(args[1].includes('--json'), 'requests machine-readable output');
		assert.ok(args[1].includes('authentication logic'), 'passes the query as a positional');
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].file, 'src/auth.ts');
	});

	test('search returns empty array on grepai failure', () => {
		const provider = new GrepaiProvider('/workspace');
		spawnSyncStub.returns({ status: 1, stdout: '', stderr: 'error', error: undefined });

		const results = provider.search('test', 5);

		assert.strictEqual(results.length, 0);
	});

	test('search returns empty array when spawn throws an error', () => {
		const provider = new GrepaiProvider('/workspace');
		spawnSyncStub.returns({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') });

		const results = provider.search('test', 5);

		assert.strictEqual(results.length, 0);
	});
});
