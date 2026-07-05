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

	test('passes a non-2xx status and error body through unchanged so the SDK handles it', async () => {
		// The Rust command returns error statuses as Ok(HttpResponse), not Err, so
		// the SDK sees the real 401/429/529 and core's handleApiError fires. If the
		// adapter dropped the status this would silently degrade to an opaque error.
		const invoke = sinon.stub().resolves({
			status: 401,
			headers: { 'content-type': 'application/json' },
			body: '{"type":"error","error":{"type":"authentication_error"}}',
		});
		const fetchFn = createAnthropicTauriFetch(invoke as unknown as InvokeFn);

		const res = await fetchFn('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });

		assert.strictEqual(res.status, 401);
		assert.strictEqual(res.ok, false);
		assert.strictEqual(await res.text(), '{"type":"error","error":{"type":"authentication_error"}}');
	});

	test('converts plain-object headers (not just a Headers instance)', async () => {
		const invoke = sinon.stub().resolves({ status: 200, headers: {}, body: '{}' });
		const fetchFn = createAnthropicTauriFetch(invoke as unknown as InvokeFn);

		await fetchFn('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: { 'x-api-key': 'sk-ant-xxx', 'anthropic-version': '2023-06-01' },
			body: '{}',
		});

		const payload = (invoke.firstCall.args[1] as { request: { headers: Record<string, string> } }).request;
		assert.strictEqual(payload.headers['x-api-key'], 'sk-ant-xxx');
		assert.strictEqual(payload.headers['anthropic-version'], '2023-06-01');
	});

	test('a null-body status (204) rebuilds a Response without throwing', async () => {
		// `new Response(body, { status: 204 })` throws if body is non-null; the
		// adapter must pass null for such statuses.
		const invoke = sinon.stub().resolves({ status: 204, headers: {}, body: '' });
		const fetchFn = createAnthropicTauriFetch(invoke as unknown as InvokeFn);

		const res = await fetchFn('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });

		assert.strictEqual(res.status, 204);
		assert.strictEqual(await res.text(), '');
	});
});
