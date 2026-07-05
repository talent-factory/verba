import * as assert from 'assert';
import * as sinon from 'sinon';

import { createAnthropicTauriFetch } from '../../adapters/anthropicTauriFetch';
import type { InvokeFn } from '../../controller';

suite('anthropicTauriFetch', () => {
	test('routes a POST through the Rust anthropic_fetch command and reconstructs the Response', async () => {
		const invoke = sinon.stub().resolves({
			status: 200,
			headers: { 'content-type': 'application/json', 'request-id': 'req_123' },
			body: '{"id":"msg_1"}',
		});
		const fetchFn = createAnthropicTauriFetch(invoke as unknown as InvokeFn);

		const res = await fetchFn('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: new Headers({ 'x-api-key': 'sk-ant-xxx', 'content-type': 'application/json' }),
			body: '{"model":"claude"}',
		});

		// Called the Rust command with the flattened request the command expects.
		assert.strictEqual(invoke.calledOnce, true);
		assert.strictEqual(invoke.firstCall.args[0], 'anthropic_fetch');
		const payload = (invoke.firstCall.args[1] as { request: { url: string; method: string; headers: Record<string, string>; body: string | null } }).request;
		assert.strictEqual(payload.url, 'https://api.anthropic.com/v1/messages');
		assert.strictEqual(payload.method, 'POST');
		assert.strictEqual(payload.headers['x-api-key'], 'sk-ant-xxx');
		assert.strictEqual(payload.headers['content-type'], 'application/json');
		assert.strictEqual(payload.body, '{"model":"claude"}');

		// Reconstructed a faithful WHATWG Response the SDK can consume.
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get('request-id'), 'req_123');
		assert.strictEqual(await res.text(), '{"id":"msg_1"}');
	});

	test('a pre-aborted signal rejects with AbortError and never calls the Rust command', async () => {
		const invoke = sinon.stub().resolves({ status: 200, headers: {}, body: '' });
		const fetchFn = createAnthropicTauriFetch(invoke as unknown as InvokeFn);
		const ac = new AbortController();
		ac.abort();

		await assert.rejects(
			fetchFn('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ac.signal }),
			(err: Error) => err.name === 'AbortError',
		);
		assert.strictEqual(invoke.called, false);
	});
});
