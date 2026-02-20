# TF-246: Whisper API Transkription - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send recorded audio to OpenAI Whisper API and insert the transcript at the cursor position.

**Architecture:** Pipeline pattern with composable `ProcessingStage` interface. `TranscriptionService` is the first stage (WAV path -> text). `DictationPipeline` chains stages. `extension.ts` orchestrates the flow: stop recording -> set "Transcribing..." status -> run pipeline -> insert text at cursor -> cleanup WAV file.

**Tech Stack:** TypeScript, OpenAI Node SDK (`openai` npm package), VS Code Extension API (`vscode.SecretStorage`), Mocha/Sinon for tests.

---

### Task 1: Install openai dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the openai npm package**

Run:
```bash
cd /Users/daniel/GitRepository/verba/.worktrees/task-tf-246
npm install openai
```

Expected: `openai` appears in `dependencies` in `package.json`, `package-lock.json` updated.

**Step 2: Verify compilation still works**

Run:
```bash
npm run compile
```

Expected: No errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add openai npm package dependency (TF-246)"
```

---

### Task 2: Create DictationPipeline (TDD)

**Files:**
- Create: `src/pipeline.ts`
- Create: `src/test/unit/pipeline.test.ts`

**Step 1: Write the failing tests**

Create `src/test/unit/pipeline.test.ts`:

```typescript
import * as assert from 'assert';
import { DictationPipeline, ProcessingStage } from '../../pipeline';

function createStage(name: string, transform: (input: string) => string): ProcessingStage {
	return {
		name,
		process: async (input: string) => transform(input),
	};
}

suite('DictationPipeline', () => {
	let pipeline: DictationPipeline;

	setup(() => {
		pipeline = new DictationPipeline();
	});

	test('returns input unchanged when no stages are added', async () => {
		const result = await pipeline.run('hello');
		assert.strictEqual(result, 'hello');
	});

	test('runs a single stage', async () => {
		pipeline.addStage(createStage('upper', (s) => s.toUpperCase()));
		const result = await pipeline.run('hello');
		assert.strictEqual(result, 'HELLO');
	});

	test('chains multiple stages in order', async () => {
		pipeline.addStage(createStage('prefix', (s) => `[${s}]`));
		pipeline.addStage(createStage('upper', (s) => s.toUpperCase()));
		const result = await pipeline.run('hello');
		assert.strictEqual(result, '[HELLO]');
	});

	test('propagates stage errors', async () => {
		pipeline.addStage({
			name: 'failing',
			process: async () => { throw new Error('stage failed'); },
		});
		await assert.rejects(
			() => pipeline.run('input'),
			/stage failed/
		);
	});

	test('stops execution on first error', async () => {
		let secondCalled = false;
		pipeline.addStage({
			name: 'failing',
			process: async () => { throw new Error('boom'); },
		});
		pipeline.addStage({
			name: 'second',
			process: async (input) => { secondCalled = true; return input; },
		});

		await assert.rejects(() => pipeline.run('input'), /boom/);
		assert.strictEqual(secondCalled, false);
	});
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
npm run compile 2>&1 | head -20
```

Expected: Compilation fails because `../../pipeline` does not exist.

**Step 3: Write minimal implementation**

Create `src/pipeline.ts`:

```typescript
export interface ProcessingStage {
	readonly name: string;
	process(input: string): Promise<string>;
}

export class DictationPipeline {
	private stages: ProcessingStage[] = [];

	addStage(stage: ProcessingStage): void {
		this.stages.push(stage);
	}

	async run(input: string): Promise<string> {
		let result = input;
		for (const stage of this.stages) {
			result = await stage.process(result);
		}
		return result;
	}
}
```

**Step 4: Compile and run tests**

Run:
```bash
npm run compile && npm run test:unit
```

Expected: All pipeline tests pass. All existing recorder tests still pass.

**Step 5: Commit**

```bash
git add src/pipeline.ts src/test/unit/pipeline.test.ts
git commit -m "feat: add DictationPipeline with ProcessingStage interface (TF-246)"
```

---

### Task 3: Create TranscriptionService (TDD)

**Files:**
- Create: `src/transcriptionService.ts`
- Create: `src/test/unit/transcriptionService.test.ts`

**Step 1: Write the failing tests**

Create `src/test/unit/transcriptionService.test.ts`:

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';

// We need to mock the openai module before importing TranscriptionService.
// Since we're in CommonJS, we can stub the module's default export.
import { TranscriptionService } from '../../transcriptionService';

// Fake SecretStorage matching vscode.SecretStorage interface
function createFakeSecretStorage(): {
	get: sinon.SinonStub;
	store: sinon.SinonStub;
	delete: sinon.SinonStub;
	onDidChange: sinon.SinonStub;
} {
	return {
		get: sinon.stub(),
		store: sinon.stub().resolves(),
		delete: sinon.stub().resolves(),
		onDidChange: sinon.stub(),
	};
}

// Fake OpenAI client
function createFakeOpenAIClient() {
	return {
		audio: {
			transcriptions: {
				create: sinon.stub(),
			},
		},
	};
}

suite('TranscriptionService', () => {
	let service: TranscriptionService;
	let secretStorage: ReturnType<typeof createFakeSecretStorage>;
	let fakeClient: ReturnType<typeof createFakeOpenAIClient>;
	let promptApiKeyStub: sinon.SinonStub;

	setup(() => {
		secretStorage = createFakeSecretStorage();
		fakeClient = createFakeOpenAIClient();
		service = new TranscriptionService(secretStorage as any);
		// Inject the fake client to avoid real API calls
		(service as any)._client = fakeClient;
		// Stub the prompt method to control API key flow
		promptApiKeyStub = sinon.stub(service as any, 'promptForApiKey');
	});

	teardown(() => {
		sinon.restore();
	});

	test('has name "Whisper Transcription"', () => {
		assert.strictEqual(service.name, 'Whisper Transcription');
	});

	suite('process()', () => {
		test('sends WAV file to whisper-1 and returns transcript', async () => {
			secretStorage.get.resolves('sk-test-key-123');
			fakeClient.audio.transcriptions.create.resolves({ text: 'Hello world' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			const result = await service.process('/tmp/test.wav');

			assert.strictEqual(result, 'Hello world');
			assert.ok(fakeClient.audio.transcriptions.create.calledOnce);
			const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
			assert.strictEqual(callArgs.model, 'whisper-1');
			assert.strictEqual(callArgs.file, 'fake-stream');
		});

		test('prompts for API key when none is stored', async () => {
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves('sk-new-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'test' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/test.wav');

			assert.ok(promptApiKeyStub.calledOnce);
			assert.ok(secretStorage.store.calledWith('openai-api-key', 'sk-new-key'));
		});

		test('throws when user cancels API key prompt', async () => {
			secretStorage.get.resolves(undefined);
			promptApiKeyStub.resolves(undefined);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/OpenAI API key required/
			);
		});

		test('uses cached API key on second call', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: 'first' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await service.process('/tmp/a.wav');
			await service.process('/tmp/b.wav');

			// secretStorage.get called twice but promptApiKeyStub never called
			assert.ok(promptApiKeyStub.notCalled);
		});

		test('throws on empty transcript', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.resolves({ text: '' });
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/No speech detected/
			);
		});

		test('clears stored key and throws on 401 authentication error', async () => {
			secretStorage.get.resolves('sk-bad-key');
			const authError = new Error('Incorrect API key provided');
			(authError as any).status = 401;
			fakeClient.audio.transcriptions.create.rejects(authError);
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Invalid OpenAI API key/
			);
			assert.ok(secretStorage.delete.calledWith('openai-api-key'));
		});

		test('throws descriptive error on network failure', async () => {
			secretStorage.get.resolves('sk-test-key');
			fakeClient.audio.transcriptions.create.rejects(new Error('ECONNREFUSED'));
			sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

			await assert.rejects(
				() => service.process('/tmp/test.wav'),
				/Transcription failed: ECONNREFUSED/
			);
		});
	});
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
npm run compile 2>&1 | head -20
```

Expected: Compilation fails because `../../transcriptionService` does not exist.

**Step 3: Write minimal implementation**

Create `src/transcriptionService.ts`:

```typescript
import * as fs from 'fs';
import OpenAI from 'openai';
import { ProcessingStage } from './pipeline';

const API_KEY_STORAGE_KEY = 'openai-api-key';

interface SecretStorage {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Sends a WAV audio file to OpenAI Whisper API and returns the transcript.
 * Implements ProcessingStage: input is a file path, output is transcript text.
 * API key is stored in VS Code SecretStorage; prompts user on first use.
 */
export class TranscriptionService implements ProcessingStage {
	readonly name = 'Whisper Transcription';
	private _client: OpenAI | null = null;
	private secretStorage: SecretStorage;

	constructor(secretStorage: SecretStorage) {
		this.secretStorage = secretStorage;
	}

	async process(input: string): Promise<string> {
		const apiKey = await this.getApiKey();
		const client = this.getClient(apiKey);

		let transcription;
		try {
			transcription = await client.audio.transcriptions.create({
				file: fs.createReadStream(input),
				model: 'whisper-1',
			});
		} catch (err: unknown) {
			if (err instanceof Error && (err as any).status === 401) {
				await this.secretStorage.delete(API_KEY_STORAGE_KEY);
				throw new Error(
					'Invalid OpenAI API key. It has been removed — you will be prompted again on next use.'
				);
			}
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`Transcription failed: ${detail}`);
		}

		if (!transcription.text || transcription.text.trim() === '') {
			throw new Error('No speech detected in recording.');
		}

		return transcription.text;
	}

	private async getApiKey(): Promise<string> {
		const stored = await this.secretStorage.get(API_KEY_STORAGE_KEY);
		if (stored) {
			return stored;
		}

		const key = await this.promptForApiKey();
		if (!key) {
			throw new Error(
				'OpenAI API key required for transcription. Use Cmd+Shift+D to try again.'
			);
		}

		await this.secretStorage.store(API_KEY_STORAGE_KEY, key);
		return key;
	}

	/** Override point for tests. In production, shows vscode.window.showInputBox. */
	protected async promptForApiKey(): Promise<string | undefined> {
		// This will be overridden in extension.ts setup to use vscode.window.showInputBox.
		// Default implementation throws to catch missing wiring.
		throw new Error('promptForApiKey not implemented');
	}

	private getClient(apiKey: string): OpenAI {
		if (!this._client) {
			this._client = new OpenAI({ apiKey });
		}
		return this._client;
	}
}
```

**Step 4: Compile and run tests**

Run:
```bash
npm run compile && npm run test:unit
```

Expected: All transcription service tests pass. All existing tests still pass.

**Step 5: Commit**

```bash
git add src/transcriptionService.ts src/test/unit/transcriptionService.test.ts
git commit -m "feat: add TranscriptionService wrapping OpenAI Whisper API (TF-246)"
```

---

### Task 4: Add setTranscribing() to StatusBarManager (TDD)

**Files:**
- Modify: `src/statusBarManager.ts:16-28` (add method after setRecording)
- Modify: `src/test/integration/statusBarManager.test.ts:37-52` (add test)

**Step 1: Write the failing test**

Add to `src/test/integration/statusBarManager.test.ts` after the "switches to recording state" test (after line 43):

```typescript
	test('switches to transcribing state', () => {
		manager.setTranscribing();
		const item = spy.firstCall.returnValue;
		assert.strictEqual(item.text, '$(loading~spin) Transcribing...');
		assert.strictEqual(item.backgroundColor, undefined);
		assert.strictEqual(item.tooltip, 'Transcribing audio...');
	});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run compile && npm run test:integration
```

Expected: FAIL — `manager.setTranscribing is not a function`.

**Step 3: Write minimal implementation**

Add to `src/statusBarManager.ts` after `setRecording()` method (after line 28):

```typescript
	setTranscribing(): void {
		this.item.text = '$(loading~spin) Transcribing...';
		this.item.backgroundColor = undefined;
		this.item.tooltip = 'Transcribing audio...';
	}
```

**Step 4: Compile and run all tests**

Run:
```bash
npm run compile && npm run test:unit && npm run test:integration
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/statusBarManager.ts src/test/integration/statusBarManager.test.ts
git commit -m "feat: add transcribing status bar state (TF-246)"
```

---

### Task 5: Wire up extension.ts — pipeline, transcription, text insertion

**Files:**
- Modify: `src/extension.ts`

This task connects all the pieces: after recording stops, the pipeline runs, the transcript is inserted at the cursor position, and the WAV file is cleaned up.

**Step 1: Update extension.ts**

Replace the full content of `src/extension.ts` with:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import { FfmpegRecorder } from './recorder';
import { StatusBarManager } from './statusBarManager';
import { DictationPipeline } from './pipeline';
import { TranscriptionService } from './transcriptionService';

class VerbaTranscriptionService extends TranscriptionService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return vscode.window.showInputBox({
			prompt: 'Enter your OpenAI API key for Whisper transcription',
			placeHolder: 'sk-...',
			password: true,
			ignoreFocusOut: true,
		});
	}
}

async function insertTextAtCursor(text: string): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		throw new Error('No active text editor. Open a file before dictating.');
	}
	await editor.edit((editBuilder) => {
		editBuilder.insert(editor.selection.active, text);
	});
}

function cleanupFile(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch {
		// Best-effort cleanup — file may already be gone
	}
}

export function activate(context: vscode.ExtensionContext) {
	const recorder = new FfmpegRecorder();
	const statusBar = new StatusBarManager();
	const pipeline = new DictationPipeline();

	pipeline.addStage(new VerbaTranscriptionService(context.secrets));

	recorder.onUnexpectedStop = (error) => {
		statusBar.setIdle();
		console.error('[Verba] Unexpected recording stop:', error);
		vscode.window.showErrorMessage(`Verba: ${error.message}`);
	};

	const disposable = vscode.commands.registerCommand(
		'dictation.start',
		async () => {
			if (recorder.isRecording) {
				let filePath: string | undefined;
				try {
					filePath = await recorder.stop();
					statusBar.setTranscribing();

					const transcript = await pipeline.run(filePath);
					await insertTextAtCursor(transcript);

					statusBar.setIdle();
					vscode.window.setStatusBarMessage(
						'$(check) Verba: transcription inserted', 5000
					);
				} catch (err: unknown) {
					statusBar.setIdle();
					console.error('[Verba] Transcription failed:', err);
					const message = err instanceof Error ? err.message : String(err);
					vscode.window.showErrorMessage(`Verba: ${message}`);
				} finally {
					if (filePath) {
						cleanupFile(filePath);
					}
				}
			} else {
				try {
					await recorder.start();
					statusBar.setRecording();
					vscode.window.showInformationMessage(
						'Verba: Recording started...'
					);
				} catch (err: unknown) {
					statusBar.setIdle();
					console.error('[Verba] Start recording failed:', err);
					const message = err instanceof Error ? err.message : String(err);

					if (message.includes('ffmpeg not found')) {
						const action = await vscode.window.showErrorMessage(
							`Verba: ${message}`,
							'Install Instructions'
						);
						if (action === 'Install Instructions') {
							vscode.env.openExternal(
								vscode.Uri.parse('https://formulae.brew.sh/formula/ffmpeg')
							);
						}
					} else {
						vscode.window.showErrorMessage(`Verba: ${message}`);
					}
				}
			}
		}
	);

	context.subscriptions.push(disposable, { dispose: () => recorder.dispose() }, statusBar);
}

export function deactivate() {}
```

**Step 2: Compile and run all tests**

Run:
```bash
npm run compile && npm run test:unit && npm run test:integration
```

Expected: All tests pass. Compilation succeeds.

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire pipeline into extension — transcribe and insert at cursor (TF-246)"
```

---

### Task 6: Manual verification and final commit

**Step 1: Verify full test suite passes**

Run:
```bash
npm run test
```

Expected: Compiles, unit tests pass, integration tests pass.

**Step 2: Push all commits**

Run:
```bash
git push origin feature/tf-246-whisper-api-transkription
```

**Step 3: Update draft PR — mark as ready for review**

Run:
```bash
gh pr ready 3
```

**Step 4: Update Linear issue status**

Use Linear MCP to update TF-246 status to "In Review".
