import * as assert from 'assert';
import * as sinon from 'sinon';

import { CleanupService } from '../../cleanupService';
import { PipelineContext } from '../../pipeline';

// Fake SecretStorage matching the SecretStorage interface in cleanupService.ts
function createFakeSecretStorage(): {
	get: sinon.SinonStub;
	store: sinon.SinonStub;
	delete: sinon.SinonStub;
} {
	return {
		get: sinon.stub(),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
	};
}

// Fake Anthropic client
function createFakeAnthropicClient() {
	return {
		messages: {
			create: sinon.stub(),
		},
	};
}

suite('CleanupService', () => {
	let service: CleanupService;
	let secretStorage: ReturnType<typeof createFakeSecretStorage>;
	let fakeClient: ReturnType<typeof createFakeAnthropicClient>;
	let promptApiKeyStub: sinon.SinonStub;

	setup(() => {
		secretStorage = createFakeSecretStorage();
		fakeClient = createFakeAnthropicClient();
		service = new CleanupService(secretStorage as any);
		// Inject the fake client to avoid real API calls
		(service as any)._client = fakeClient;
		// Stub the prompt method to control API key flow
		promptApiKeyStub = sinon.stub(service as any, 'promptForApiKey');
	});

	teardown(() => {
		sinon.restore();
	});

	test('has name "Text Cleanup"', () => {
		assert.strictEqual(service.name, 'Text Cleanup');
	});

	suite('process()', () => {
		test('sends transcript to Claude and returns cleaned text', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'Cleaned text output' }],
			});

			const result = await service.process('Ähm, das ist halt ein Test, eigentlich.');

			assert.strictEqual(result, 'Cleaned text output');
			assert.ok(fakeClient.messages.create.calledOnce);
			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.strictEqual(callArgs.model, 'claude-haiku-4-5-20251001');
			assert.ok(callArgs.max_tokens > 0);
			assert.ok(callArgs.messages[0].content.includes('Ähm, das ist halt ein Test, eigentlich.'));
		});

		test('includes system prompt for German filler word removal', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system, 'should have a system prompt');
			assert.ok(callArgs.system.includes('Füllwörter'), 'system prompt should mention filler words');
		});

		test('prompts for API key when none is stored', async () => {
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves('sk-ant-new-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test');

			assert.ok(promptApiKeyStub.calledOnce);
			assert.ok(secretStorage.store.calledWith('anthropic-api-key', 'sk-ant-new-key'));
		});

		test('throws when user cancels API key prompt', async () => {
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves(undefined);

			await assert.rejects(
				() => service.process('test'),
				/Anthropic API key required/
			);
		});

		test('returns raw input when Claude response is empty', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: '' }],
			});

			const result = await service.process('raw input text');

			assert.strictEqual(result, 'raw input text');
		});

		test('returns raw input when response content block is not text type', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'tool_use', id: 'test', name: 'test', input: {} }],
			});

			const result = await service.process('raw input text');

			assert.strictEqual(result, 'raw input text');
		});

		test('clears stored key, resets client, and throws on 401 error', async () => {
			secretStorage.get.resolves('sk-ant-bad-key');
			const authError = new Error('Invalid API key');
			(authError as any).status = 401;
			fakeClient.messages.create.rejects(authError);

			await assert.rejects(
				() => service.process('test'),
				/Invalid Anthropic API key/
			);
			assert.ok(secretStorage.delete.calledWith('anthropic-api-key'));
			assert.strictEqual((service as any)._client, null, 'client should be cleared after 401');
		});

		test('recovers after 401 by prompting for new key on next call', async () => {
			// First call: stored key → 401 → key deleted, client nulled
			secretStorage.get.resolves('sk-ant-bad-key');
			const authError = new Error('Invalid API key');
			(authError as any).status = 401;
			fakeClient.messages.create.rejects(authError);

			await assert.rejects(
				() => service.process('test'),
				/Invalid Anthropic API key/
			);
			assert.strictEqual((service as any)._client, null);

			// Second call: no stored key → prompt → new key → success
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves('sk-ant-new-key');
			const newFakeClient = createFakeAnthropicClient();
			newFakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'recovered text' }],
			});
			(service as any)._client = newFakeClient;

			const result = await service.process('recovery test');

			assert.strictEqual(result, 'recovered text');
			assert.ok(promptApiKeyStub.calledOnce);
			assert.ok(secretStorage.store.calledWith('anthropic-api-key', 'sk-ant-new-key'));
		});

		test('throws rate limit error on 429', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			const rateLimitError = new Error('Rate limit exceeded');
			(rateLimitError as any).status = 429;
			fakeClient.messages.create.rejects(rateLimitError);

			await assert.rejects(
				() => service.process('test'),
				/rate limit reached/
			);
		});

		test('throws descriptive error on network failure', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.rejects(new Error('ECONNREFUSED'));

			await assert.rejects(
				() => service.process('test'),
				/Post-processing failed: ECONNREFUSED/
			);
		});

		test('uses custom system prompt from context when provided', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'commit: fix login bug' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Convert to a commit message.',
			};
			await service.process('test input', context);

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Convert to a commit message.'), 'should contain template prompt');
			assert.ok(callArgs.system.includes('raw speech transcript'), 'should contain framing context');
		});

		test('uses default system prompt when no context is provided', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Füllwörter'), 'should use default filler word prompt');
		});

	});
});
