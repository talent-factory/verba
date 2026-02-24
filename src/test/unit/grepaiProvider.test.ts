import * as assert from 'assert';
import * as sinon from 'sinon';
import * as child_process from 'child_process';
import * as fs from 'fs';

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
