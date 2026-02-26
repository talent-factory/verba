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
			stream: sinon.stub(),
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
			assert.ok(callArgs.messages[0].content.includes('<transcript>'));
			assert.ok(callArgs.messages[0].content.includes('Ähm, das ist halt ein Test, eigentlich.'));
			assert.ok(callArgs.messages[0].content.includes('</transcript>'));
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
			assert.ok(callArgs.system.includes('<transcript>'), 'system prompt should reference transcript tags');
		});

		test('default system prompt includes course correction instruction', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Selbstkorrektur'),
				'system prompt should mention self-correction');
		});

		test('default system prompt includes voice commands instruction', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Sprachbefehl'),
				'system prompt should mention voice commands');
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
			assert.ok(callArgs.system.includes('<transcript>'), 'should reference transcript tags in framing');
		});

		test('template system prompt includes course correction instruction', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'commit: fix login bug' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Convert to a commit message.',
			};
			await service.process('test input', context);

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Selbstkorrektur'),
				'template prompt should include course correction instruction');
		});

		test('template system prompt includes voice commands instruction', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'commit: fix login bug' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Convert to a commit message.',
			};
			await service.process('test input', context);

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Sprachbefehl'),
				'template prompt should include voice commands instruction');
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


		test('includes context snippets before transcript when provided', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'commented code' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Generate a code comment.',
				contextSnippets: [
					'// file: src/auth.ts\nfunction login(user: string) { return true; }',
					'// file: src/session.ts\nclass Session { start() {} }',
				],
			};
			await service.process('add a comment for the login function', context);

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			const userContent = callArgs.messages[0].content;
			assert.ok(userContent.includes('<context>'), 'should contain context tags');
			assert.ok(userContent.includes('src/auth.ts'), 'should contain first snippet');
			assert.ok(userContent.includes('src/session.ts'), 'should contain second snippet');
			assert.ok(userContent.indexOf('<context>') < userContent.indexOf('<transcript>'),
				'context should appear before transcript');
		});

		test('omits context block when contextSnippets is empty', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Clean up.',
				contextSnippets: [],
			};
			await service.process('test input', context);

			const userContent = fakeClient.messages.create.firstCall.args[0].messages[0].content;
			assert.ok(!userContent.includes('<context>'), 'should not contain context tags when empty');
		});

		test('omits context block when contextSnippets is undefined', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			const context: PipelineContext = { templatePrompt: 'Clean up.' };
			await service.process('test input', context);

			const userContent = fakeClient.messages.create.firstCall.args[0].messages[0].content;
			assert.ok(!userContent.includes('<context>'), 'should not contain context tags when undefined');
		});

		test('default system prompt includes glossary instruction when glossary is set', async () => {
			service.setGlossary(['Visual Studio Code', 'Kubernetes']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Visual Studio Code'),
				'system prompt should include glossary term');
			assert.ok(callArgs.system.includes('Kubernetes'),
				'system prompt should include glossary term');
		});

		test('default system prompt has no glossary instruction when glossary is empty', async () => {
			service.setGlossary([]);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(!callArgs.system.includes('exakt bei'),
				'system prompt should not include glossary instruction when empty');
		});

		test('template system prompt includes glossary instruction when glossary is set', async () => {
			service.setGlossary(['Spring Boot']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Convert to a commit message.',
			};
			await service.process('test input', context);

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Spring Boot'),
				'template prompt should include glossary term');
		});

		test('setGlossary replaces previous glossary completely', async () => {
			service.setGlossary(['OldTerm']);
			service.setGlossary(['NewTerm']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('NewTerm'),
				'system prompt should include new glossary term');
			assert.ok(!callArgs.system.includes('OldTerm'),
				'system prompt should not include old glossary term');
		});

		test('glossary instruction contains key preservation phrases', async () => {
			service.setGlossary(['TestTerm']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('exakt bei'),
				'instruction should contain "exakt bei"');
			assert.ok(callArgs.system.includes('nicht uebersetzen'),
				'instruction should contain "nicht uebersetzen"');
			assert.ok(callArgs.system.includes('nicht aendern'),
				'instruction should contain "nicht aendern"');
		});

		test('glossary terms with commas are included correctly', async () => {
			service.setGlossary(['Acme, Inc.', 'Kubernetes']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('Acme, Inc.'),
				'system prompt should include term with comma');
			assert.ok(callArgs.system.includes('Kubernetes'),
				'system prompt should include other term');
		});

		test('glossary instruction appears on new line in default prompt', async () => {
			service.setGlossary(['TestTerm']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('\nBehalte folgende Begriffe'),
				'glossary instruction should start on new line');
		});

		test('glossary instruction appears between framing and template prompt', async () => {
			service.setGlossary(['TestTerm']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			const context: PipelineContext = {
				templatePrompt: 'Convert to a commit message.',
			};
			await service.process('test input', context);

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			const glossaryIdx = callArgs.system.indexOf('Behalte folgende Begriffe');
			const templateIdx = callArgs.system.indexOf('Convert to a commit message.');
			assert.ok(glossaryIdx > 0, 'glossary instruction should be present');
			assert.ok(templateIdx > glossaryIdx,
				'template prompt should appear after glossary instruction');
		});

		test('setGlossary makes a defensive copy of the array', async () => {
			const terms = ['OriginalTerm'];
			service.setGlossary(terms);
			terms.push('MutatedTerm');

			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.resolves({
				content: [{ type: 'text', text: 'cleaned' }],
			});

			await service.process('test input');

			const callArgs = fakeClient.messages.create.firstCall.args[0];
			assert.ok(callArgs.system.includes('OriginalTerm'),
				'system prompt should include original term');
			assert.ok(!callArgs.system.includes('MutatedTerm'),
				'system prompt should not include mutated term');
		});

	});

	suite('processStreaming()', () => {
		function createFakeStream(chunks: string[], options?: { throwDuring?: Error }) {
			return {
				[Symbol.asyncIterator]: async function* () {
					for (const chunk of chunks) {
						yield { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } };
					}
					if (options?.throwDuring) {
						throw options.throwDuring;
					}
				},
				abort: sinon.stub(),
			};
		}

		test('streams tokens and calls onChunk with char count', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			const fakeStream = createFakeStream(['Hello', ' world', '!']);
			fakeClient.messages.stream.returns(fakeStream);

			const onChunk = sinon.stub();
			const result = await service.processStreaming('raw input', undefined, onChunk);

			assert.strictEqual(result, 'Hello world!');
			assert.strictEqual(onChunk.callCount, 3);
			assert.deepStrictEqual(onChunk.firstCall.args, [5]);
			assert.deepStrictEqual(onChunk.secondCall.args, [11]);
			assert.deepStrictEqual(onChunk.thirdCall.args, [12]);
		});

		test('uses same system prompt and message format as process()', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			const context: PipelineContext = {
				templatePrompt: 'Convert to commit message.',
				contextSnippets: ['// file: src/auth.ts\nfunction login() {}'],
			};
			await service.processStreaming('test input', context, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.strictEqual(callArgs.model, 'claude-haiku-4-5-20251001');
			assert.ok(callArgs.system.includes('Convert to commit message.'));
			assert.ok(callArgs.messages[0].content.includes('<context>'));
			assert.ok(callArgs.messages[0].content.includes('<transcript>'));
		});

		test('streaming uses course correction in default prompt', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			await service.processStreaming('test input', undefined, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.ok(callArgs.system.includes('Selbstkorrektur'),
				'streaming default prompt should include course correction');
		});

		test('streaming uses course correction in template prompt', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			const context: PipelineContext = {
				templatePrompt: 'Convert to markdown.',
			};
			await service.processStreaming('test input', context, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.ok(callArgs.system.includes('Selbstkorrektur'),
				'streaming template prompt should include course correction');
		});

		test('streaming uses voice commands in default prompt', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			await service.processStreaming('test input', undefined, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.ok(callArgs.system.includes('Sprachbefehl'),
				'streaming default prompt should include voice commands');
		});

		test('streaming uses voice commands in template prompt', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			const context: PipelineContext = {
				templatePrompt: 'Convert to markdown.',
			};
			await service.processStreaming('test input', context, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.ok(callArgs.system.includes('Sprachbefehl'),
				'streaming template prompt should include voice commands');
		});

		test('streaming uses glossary in default prompt', async () => {
			service.setGlossary(['TypeScript']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			await service.processStreaming('test input', undefined, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.ok(callArgs.system.includes('TypeScript'),
				'streaming default prompt should include glossary term');
		});

		test('streaming uses glossary in template prompt', async () => {
			service.setGlossary(['Kubernetes']);
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

			const context: PipelineContext = {
				templatePrompt: 'Convert to markdown.',
			};
			await service.processStreaming('test input', context, sinon.stub());

			const callArgs = fakeClient.messages.stream.firstCall.args[0];
			assert.ok(callArgs.system.includes('Kubernetes'),
				'streaming template prompt should include glossary term');
		});

		test('returns raw input when stream produces empty text', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream([]));

			const result = await service.processStreaming('raw input', undefined, sinon.stub());
			assert.strictEqual(result, 'raw input');
		});

		test('aborts stream and throws AbortError when signal fires', async () => {
			secretStorage.get.resolves('sk-ant-test-key');

			const abortController = new AbortController();
			// Stream that blocks until abort causes it to throw
			const fakeStream = {
				[Symbol.asyncIterator]: async function* () {
					yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
					// Simulate: abort fires → stream.abort() called → iterator throws
					abortController.abort();
					throw new Error('Request was aborted.');
				},
				abort: sinon.stub(),
			};
			fakeClient.messages.stream.returns(fakeStream);

			await assert.rejects(
				() => service.processStreaming('test', undefined, sinon.stub(), abortController.signal),
				(err: Error) => err.name === 'AbortError',
			);
			assert.ok(fakeStream.abort.calledOnce, 'stream.abort() should be called via event listener');
		});

		test('throws on 401 error during iteration and clears key', async () => {
			secretStorage.get.resolves('sk-ant-bad-key');
			const authError = new Error('Invalid API key');
			(authError as any).status = 401;
			fakeClient.messages.stream.returns(createFakeStream([], { throwDuring: authError }));

			await assert.rejects(
				() => service.processStreaming('test', undefined, sinon.stub()),
				/Invalid Anthropic API key/,
			);
			assert.ok(secretStorage.delete.calledWith('anthropic-api-key'));
			assert.strictEqual((service as any)._client, null);
		});

		test('throws rate limit error on 429 during iteration', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			const rateLimitError = new Error('Rate limit exceeded');
			(rateLimitError as any).status = 429;
			fakeClient.messages.stream.returns(createFakeStream([], { throwDuring: rateLimitError }));

			await assert.rejects(
				() => service.processStreaming('test', undefined, sinon.stub()),
				/rate limit reached/,
			);
		});

		test('wraps mid-stream network errors with descriptive message', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(
				createFakeStream(['partial'], { throwDuring: new Error('Connection reset') }),
			);

			await assert.rejects(
				() => service.processStreaming('test', undefined, sinon.stub()),
				/Post-processing failed: Connection reset/,
			);
		});

		test('onChunk callback failure does not crash the stream', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['Hello', ' world']));

			const onChunk = sinon.stub().onFirstCall().throws(new Error('UI crashed'));
			const result = await service.processStreaming('raw input', undefined, onChunk);

			assert.strictEqual(result, 'Hello world');
			assert.strictEqual(onChunk.callCount, 2, 'onChunk should still be called for both chunks');
		});

		test('ignores non-text_delta events in the stream', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			const fakeStream = {
				[Symbol.asyncIterator]: async function* () {
					yield { type: 'message_start', message: {} };
					yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
					yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
					yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } };
					yield { type: 'content_block_stop', index: 0 };
				},
				abort: sinon.stub(),
			};
			fakeClient.messages.stream.returns(fakeStream);

			const onChunk = sinon.stub();
			const result = await service.processStreaming('test', undefined, onChunk);

			assert.strictEqual(result, 'Hello');
			assert.strictEqual(onChunk.callCount, 1);
		});

		test('cleans up abort event listener after completion', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.stream.returns(createFakeStream(['done']));

			const abortController = new AbortController();
			const removeSpy = sinon.spy(abortController.signal, 'removeEventListener');

			await service.processStreaming('test', undefined, sinon.stub(), abortController.signal);

			assert.ok(removeSpy.calledOnce, 'removeEventListener should be called in finally block');
		});
	});
});
