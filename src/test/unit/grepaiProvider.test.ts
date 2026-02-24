import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';

import { GrepaiProvider, parseGrepaiOutput } from '../../grepaiProvider';

suite('parseGrepaiOutput', () => {
	test('parses file:line content format', () => {
		const output = `src/auth.ts:10: function login() { return true; }
src/auth.ts:11:   // validates user
src/session.ts:5: class Session {}`;

		const results = parseGrepaiOutput(output);

		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].file, 'src/auth.ts');
		assert.ok(results[0].content.includes('function login'));
		assert.strictEqual(results[1].file, 'src/session.ts');
	});

	test('returns empty array for empty output', () => {
		assert.strictEqual(parseGrepaiOutput('').length, 0);
		assert.strictEqual(parseGrepaiOutput('\n').length, 0);
	});
});

suite('GrepaiProvider', () => {
	let spawnSyncStub: sinon.SinonStub;

	setup(() => {
		spawnSyncStub = sinon.stub(child_process, 'spawnSync');
	});

	teardown(() => {
		sinon.restore();
	});

	test('isAvailable returns true when grepai is found', () => {
		spawnSyncStub.returns({ status: 0, stdout: '/usr/local/bin/grepai\n', error: undefined });
		assert.strictEqual(GrepaiProvider.isAvailable(), true);
	});

	test('isAvailable returns false when grepai is not found', () => {
		spawnSyncStub.returns({ status: 1, stdout: '', error: new Error('not found') });
		assert.strictEqual(GrepaiProvider.isAvailable(), false);
	});

	test('search calls grepai search CLI and returns results', () => {
		const provider = new GrepaiProvider('/workspace');
		spawnSyncStub.returns({
			status: 0,
			stdout: 'src/auth.ts:10: function login() {}\n',
			stderr: '',
			error: undefined,
		});

		const results = provider.search('authentication logic', 5);

		assert.ok(spawnSyncStub.calledOnce);
		const args = spawnSyncStub.firstCall.args;
		assert.strictEqual(args[0], 'grepai');
		assert.ok(args[1].includes('search'));
		assert.ok(results.length > 0);
	});

	test('search returns empty array on grepai failure', () => {
		const provider = new GrepaiProvider('/workspace');
		spawnSyncStub.returns({ status: 1, stdout: '', stderr: 'error', error: undefined });

		const results = provider.search('test', 5);

		assert.strictEqual(results.length, 0);
	});
});
