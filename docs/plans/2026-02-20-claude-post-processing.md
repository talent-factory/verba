# Claude Post-Processing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude-powered post-processing to clean up raw Whisper transcripts (remove filler words, smooth sentences) before inserting text at the cursor.

**Architecture:** A new `CleanupService` implements the existing `ProcessingStage` interface and is added as the second stage in the `DictationPipeline`. It mirrors the `TranscriptionService` pattern: manages its own Anthropic API key via `SecretStorage`, calls Claude Haiku with a German-optimized cleanup prompt, and has a protected `promptForApiKey()` override point for VS Code integration and testability.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` npm package, VS Code SecretStorage, Mocha/Sinon (TDD-style: `suite`/`test`/`setup`/`teardown`)

---

### Task 1: Install @anthropic-ai/sdk dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

Run: `npm install @anthropic-ai/sdk`

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Verify existing tests still pass**

Run: `npm run test:unit`
Expected: 36 passing

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @anthropic-ai/sdk npm package dependency (TF-247)"
```

---

### Task 2: CleanupService TDD — core implementation

**Files:**
- Create: `src/cleanupService.ts`
- Create: `src/test/unit/cleanupService.test.ts`

**Step 1: Write the failing tests**

Create `src/test/unit/cleanupService.test.ts`:

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';

import { CleanupService } from '../../cleanupService';

// Fake SecretStorage matching vscode.SecretStorage interface
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

		test('throws descriptive error on network failure', async () => {
			secretStorage.get.resolves('sk-ant-test-key');
			fakeClient.messages.create.rejects(new Error('ECONNREFUSED'));

			await assert.rejects(
				() => service.process('test'),
				/Post-processing failed: ECONNREFUSED/
			);
		});
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: Compilation error — `CleanupService` does not exist yet.

**Step 3: Write the implementation**

Create `src/cleanupService.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { ProcessingStage } from './pipeline';

const API_KEY_STORAGE_KEY = 'anthropic-api-key';

const CLEANUP_SYSTEM_PROMPT = `Du erhältst ein rohes Sprach-Transkript. Bereinige es:
- Entferne Füllwörter (ähm, äh, halt, eigentlich, sozusagen, quasi, irgendwie, etc.)
- Glätte abgebrochene oder wiederholte Satzanfänge
- Korrigiere offensichtliche Transkriptionsfehler
- Behalte den exakten Sinn und Stil bei
- Gib NUR den bereinigten Text zurück, ohne Erklärungen`;

interface SecretStorage {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Cleans up a raw transcript using Claude API: removes filler words,
 * smooths sentences, corrects transcription errors.
 * Implements ProcessingStage: input is raw transcript, output is cleaned text.
 * API key is stored in VS Code SecretStorage; prompts user on first use.
 */
export class CleanupService implements ProcessingStage {
	readonly name = 'Text Cleanup';
	private _client: Anthropic | null = null;
	private secretStorage: SecretStorage;

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	async process(input: string): Promise<string> {
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		let response;
		try {
			response = await client.messages.create({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 4096,
				system: CLEANUP_SYSTEM_PROMPT,
				messages: [{ role: 'user', content: input }],
			});
		} catch (err: unknown) {
			if (err instanceof Error && (err as any).status === 401) {
				this._client = null;
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(
					'Invalid Anthropic API key. It has been removed — you will be prompted again on next use.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Post-processing failed: ${detail}`);
		}

		const text = response.content[0]?.type === 'text'
			? response.content[0].text
			: '';

		if (!text || text.trim() === '') {
			return input;
		}

		return text;
	}

	private async getApiKey(): Promise<string> {
		const stored = await this.secretStorage.get(API_KEY_STORAGE_KEY);
		if (stored) {
			return stored;
		}

		const key = await this.promptForApiKey();
		if (!key) {
			throw new Error(
				'Anthropic API key required for post-processing.'
			);
		}

		await this.secretStorage.store(API_KEY_STORAGE_KEY, key);
		return key;
	}

	protected async promptForApiKey(): Promise<string | undefined> {
		throw new Error('promptForApiKey not implemented');
	}

	private getClient(apiKey: string): Anthropic {
		if (!this._client) {
			this._client = new Anthropic({ apiKey });
		}
		return this._client;
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: All tests passing (36 existing + 8 new = 44 total)

**Step 5: Commit**

```bash
git add src/cleanupService.ts src/test/unit/cleanupService.test.ts
git commit -m "feat: add CleanupService wrapping Anthropic Claude API (TF-247)"
```

---

### Task 3: Wire CleanupService into extension pipeline

**Files:**
- Modify: `src/extension.ts:1-49`

**Step 1: Add VerbaCleanupService subclass and wire into pipeline**

Add import at top of `src/extension.ts`:

```typescript
import { CleanupService } from './cleanupService';
```

Add subclass after `VerbaTranscriptionService` (after line 17):

```typescript
class VerbaCleanupService extends CleanupService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return vscode.window.showInputBox({
			prompt: 'Enter your Anthropic API key for text cleanup',
			placeHolder: 'sk-ant-...',
			password: true,
			ignoreFocusOut: true,
		});
	}
}
```

Add second pipeline stage in `activate()`, after the existing `addStage` call (after line 49):

```typescript
pipeline.addStage(new VerbaCleanupService(context.secrets));
```

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Verify all tests still pass**

Run: `npm run test:unit`
Expected: 44 passing

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire CleanupService as second pipeline stage (TF-247)"
```

---

### Task 4: Final verification and push

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `npm run compile && npm run test:unit`
Expected: 44 passing (28 recorder + 5 pipeline + 8 transcription + 8 cleanup... total should be around 44-45, verify exact count)

**Step 2: Verify the full pipeline data flow conceptually**

Check that `extension.ts` has:
1. `pipeline.addStage(new VerbaTranscriptionService(...))` — Stage 1: WAV → text
2. `pipeline.addStage(new VerbaCleanupService(...))` — Stage 2: text → cleaned text

**Step 3: Push to remote**

Run: `git push origin feature/tf-247-claude-post-processing`

**Step 4: Mark PR #4 as ready for review**

Run: `gh pr ready 4`

**Step 5: Update Linear TF-247 to "In Review"**

Use Linear MCP: `update_issue(id: "TF-247", state: "In Review")`
