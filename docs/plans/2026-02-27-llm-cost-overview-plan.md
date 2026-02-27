# LLM Cost Tracking & Overview — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track actual API usage costs from every LLM call and display cumulative costs in a WebView panel.

**Architecture:** Services expose `lastUsage` after each API call. `extension.ts` reads it and feeds it to `CostTracker`, which persists data to `globalState`. A `CostOverviewPanel` renders the WebView with card layout.

**Tech Stack:** TypeScript, VS Code Extension API (WebviewPanel, globalState), OpenAI SDK, Anthropic SDK, Mocha/Sinon for tests.

---

### Task 1: CostTracker Service — Tests

**Files:**
- Create: `src/costTracker.ts` (empty export for compilation)
- Create: `src/test/unit/costTracker.test.ts`

**Step 1: Create minimal costTracker.ts for compilation**

```typescript
// src/costTracker.ts
export interface UsageRecord {
	timestamp: number;
	model: string;
	provider: 'openai' | 'anthropic';
	inputTokens?: number;
	outputTokens?: number;
	audioDurationSec?: number;
	costUsd: number;
}

export interface GlobalState {
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: unknown): Thenable<void>;
}

export class CostTracker {
	constructor(_globalState: GlobalState) {}
	trackWhisperUsage(_audioDurationSec: number): void {}
	trackClaudeUsage(_inputTokens: number, _outputTokens: number): void {}
	trackEmbeddingUsage(_promptTokens: number): void {}
	getSessionCosts(): number { return 0; }
	getTotalCosts(): number { return 0; }
	getSessionRecords(): UsageRecord[] { return []; }
	getTotalRecords(): UsageRecord[] { return []; }
	resetTotalCosts(): void {}
}
```

**Step 2: Write failing tests**

```typescript
// src/test/unit/costTracker.test.ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import { CostTracker, UsageRecord } from '../../costTracker';

function createFakeGlobalState() {
	const store = new Map<string, unknown>();
	return {
		get: <T>(key: string, defaultValue: T): T => (store.has(key) ? store.get(key) as T : defaultValue),
		update: sinon.stub().callsFake((key: string, value: unknown) => {
			store.set(key, value);
			return Promise.resolve();
		}),
	};
}

suite('CostTracker', () => {
	let tracker: CostTracker;
	let globalState: ReturnType<typeof createFakeGlobalState>;

	setup(() => {
		globalState = createFakeGlobalState();
		tracker = new CostTracker(globalState);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('trackWhisperUsage()', () => {
		test('calculates cost from audio duration at $0.006/min', () => {
			tracker.trackWhisperUsage(60); // 1 minute
			assert.strictEqual(tracker.getSessionCosts(), 0.006);
		});

		test('handles fractional minutes', () => {
			tracker.trackWhisperUsage(30); // 30 seconds = 0.5 min
			const cost = tracker.getSessionCosts();
			assert.ok(Math.abs(cost - 0.003) < 0.0001);
		});

		test('creates a UsageRecord with correct fields', () => {
			tracker.trackWhisperUsage(120);
			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].model, 'whisper-1');
			assert.strictEqual(records[0].provider, 'openai');
			assert.strictEqual(records[0].audioDurationSec, 120);
			assert.ok(Math.abs(records[0].costUsd - 0.012) < 0.0001);
		});
	});

	suite('trackClaudeUsage()', () => {
		test('calculates cost from input and output tokens', () => {
			tracker.trackClaudeUsage(1000, 500);
			// input: 1000/1M * $1.00 = $0.001, output: 500/1M * $5.00 = $0.0025
			const cost = tracker.getSessionCosts();
			assert.ok(Math.abs(cost - 0.0035) < 0.0001);
		});

		test('creates a UsageRecord with correct fields', () => {
			tracker.trackClaudeUsage(2000, 1000);
			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].model, 'claude-haiku-4-5-20251001');
			assert.strictEqual(records[0].provider, 'anthropic');
			assert.strictEqual(records[0].inputTokens, 2000);
			assert.strictEqual(records[0].outputTokens, 1000);
		});
	});

	suite('trackEmbeddingUsage()', () => {
		test('calculates cost from prompt tokens at $0.020/1M', () => {
			tracker.trackEmbeddingUsage(10000);
			// 10000/1M * $0.020 = $0.0002
			const cost = tracker.getSessionCosts();
			assert.ok(Math.abs(cost - 0.0002) < 0.00001);
		});

		test('creates a UsageRecord with correct fields', () => {
			tracker.trackEmbeddingUsage(5000);
			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].model, 'text-embedding-3-small');
			assert.strictEqual(records[0].provider, 'openai');
			assert.strictEqual(records[0].inputTokens, 5000);
		});
	});

	suite('aggregation', () => {
		test('getSessionCosts sums all session records', () => {
			tracker.trackWhisperUsage(60);    // $0.006
			tracker.trackClaudeUsage(1000, 0); // $0.001
			const total = tracker.getSessionCosts();
			assert.ok(Math.abs(total - 0.007) < 0.0001);
		});

		test('getSessionRecords returns all session records in order', () => {
			tracker.trackWhisperUsage(60);
			tracker.trackClaudeUsage(1000, 500);
			tracker.trackEmbeddingUsage(5000);
			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 3);
			assert.strictEqual(records[0].model, 'whisper-1');
			assert.strictEqual(records[1].model, 'claude-haiku-4-5-20251001');
			assert.strictEqual(records[2].model, 'text-embedding-3-small');
		});
	});

	suite('persistence', () => {
		test('track calls persist to globalState', () => {
			tracker.trackClaudeUsage(1000, 500);
			assert.ok(globalState.update.calledWith('verba.costRecords'));
		});

		test('getTotalCosts includes records from previous sessions', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState.update('verba.costRecords', previousRecords);
			const freshTracker = new CostTracker(globalState);
			assert.ok(Math.abs(freshTracker.getTotalCosts() - 0.006) < 0.0001);
		});

		test('getTotalCosts includes both previous and current session', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState.update('verba.costRecords', previousRecords);
			const freshTracker = new CostTracker(globalState);
			freshTracker.trackClaudeUsage(1000, 0); // $0.001
			assert.ok(Math.abs(freshTracker.getTotalCosts() - 0.007) < 0.0001);
		});

		test('resetTotalCosts clears globalState and session', () => {
			tracker.trackClaudeUsage(1000, 500);
			tracker.resetTotalCosts();
			assert.strictEqual(tracker.getSessionCosts(), 0);
			assert.strictEqual(tracker.getTotalCosts(), 0);
			assert.strictEqual(tracker.getSessionRecords().length, 0);
		});
	});
});
```

**Step 3: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/costTracker.test.js --ui tdd --timeout 5000`
Expected: Multiple FAIL (stub methods return 0/empty)

**Step 4: Implement CostTracker**

Write the full implementation in `src/costTracker.ts`:
- Pricing constants
- `track*()` methods that create UsageRecord and persist
- `get*()` methods for aggregation
- `resetTotalCosts()` clears both arrays

**Step 5: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/costTracker.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 6: Commit**

```
git add src/costTracker.ts src/test/unit/costTracker.test.ts
/commit
```

---

### Task 2: CleanupService — Extract Usage Data

**Files:**
- Modify: `src/cleanupService.ts` (add `lastUsage` property, extract usage from responses)
- Modify: `src/test/unit/cleanupService.test.ts` (add usage extraction tests)

**Step 1: Write failing tests for usage extraction**

Add to `src/test/unit/cleanupService.test.ts`:

In the `process()` suite, add:
```typescript
test('exposes lastUsage after successful API call', async () => {
	secretStorage.get.resolves('sk-ant-test-key');
	fakeClient.messages.create.resolves({
		content: [{ type: 'text', text: 'cleaned' }],
		usage: { input_tokens: 150, output_tokens: 42 },
	});

	await service.process('test input');

	assert.deepStrictEqual(service.lastUsage, { inputTokens: 150, outputTokens: 42 });
});

test('lastUsage is undefined when response has no usage field', async () => {
	secretStorage.get.resolves('sk-ant-test-key');
	fakeClient.messages.create.resolves({
		content: [{ type: 'text', text: 'cleaned' }],
	});

	await service.process('test input');

	assert.strictEqual(service.lastUsage, undefined);
});
```

In the `processStreaming()` suite, add:
```typescript
test('exposes lastUsage after streaming completes', async () => {
	secretStorage.get.resolves('sk-ant-test-key');
	const fakeStream = createFakeStream(['Hello', ' world']);
	fakeStream.finalMessage = sinon.stub().resolves({
		usage: { input_tokens: 200, output_tokens: 80 },
	});
	fakeClient.messages.stream.returns(fakeStream);

	await service.processStreaming('raw input', undefined, sinon.stub());

	assert.deepStrictEqual(service.lastUsage, { inputTokens: 200, outputTokens: 80 });
});
```

Note: The `createFakeStream` helper needs `finalMessage` added as a property.

**Step 2: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/cleanupService.test.js --ui tdd --timeout 5000`
Expected: FAIL (`lastUsage` is undefined)

**Step 3: Implement usage extraction in CleanupService**

In `src/cleanupService.ts`:

1. Add property: `lastUsage?: { inputTokens: number; outputTokens: number };`

2. In `process()` method, after line 64 (after `client.messages.create()`):
```typescript
this.lastUsage = response.usage
	? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
	: undefined;
```

3. In `processStreaming()` method, after the for-await loop (after line 114), before the catch:
```typescript
try {
	const finalMsg = await stream.finalMessage();
	this.lastUsage = finalMsg.usage
		? { inputTokens: finalMsg.usage.input_tokens, outputTokens: finalMsg.usage.output_tokens }
		: undefined;
} catch {
	this.lastUsage = undefined;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/cleanupService.test.js --ui tdd --timeout 5000`
Expected: All PASS (existing + new tests)

**Step 5: Commit**

```
git add src/cleanupService.ts src/test/unit/cleanupService.test.ts
/commit
```

---

### Task 3: EmbeddingService — Extract Usage Data

**Files:**
- Modify: `src/embeddingService.ts` (add `lastUsage` property)
- Modify: `src/test/unit/embeddingService.test.ts` (add usage extraction tests)

**Step 1: Write failing tests**

Add to `src/test/unit/embeddingService.test.ts`:

```typescript
test('exposes lastUsage after successful API call', async () => {
	fakeClient.embeddings.create.resolves({
		data: [{ embedding: [0.1, 0.2] }],
		usage: { prompt_tokens: 42, total_tokens: 42 },
	});

	await service.embed('hello');

	assert.deepStrictEqual(service.lastUsage, { promptTokens: 42 });
});

test('lastUsage is undefined when response has no usage field', async () => {
	fakeClient.embeddings.create.resolves({
		data: [{ embedding: [0.1, 0.2] }],
	});

	await service.embed('hello');

	assert.strictEqual(service.lastUsage, undefined);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/embeddingService.test.js --ui tdd --timeout 5000`
Expected: FAIL

**Step 3: Implement usage extraction in EmbeddingService**

In `src/embeddingService.ts`:

1. Add property: `lastUsage?: { promptTokens: number };`

2. In `embedBatch()`, after `response = await client.embeddings.create(...)` (after line 49):
```typescript
this.lastUsage = response.usage
	? { promptTokens: response.usage.prompt_tokens }
	: undefined;
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/embeddingService.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 5: Commit**

```
git add src/embeddingService.ts src/test/unit/embeddingService.test.ts
/commit
```

---

### Task 4: CostOverviewPanel — WebView

**Files:**
- Create: `src/costOverviewPanel.ts`
- Create: `src/test/unit/costOverviewPanel.test.ts`

**Step 1: Write failing tests for HTML generation**

```typescript
// src/test/unit/costOverviewPanel.test.ts
import * as assert from 'assert';
import { buildCostOverviewHtml, AggregatedModel } from '../../costOverviewPanel';

suite('CostOverviewPanel', () => {
	suite('buildCostOverviewHtml()', () => {
		test('renders card for each model grouped by provider', () => {
			const models: AggregatedModel[] = [
				{ model: 'whisper-1', provider: 'openai', category: 'Transcription', totalCostUsd: 0.006, audioDurationSec: 60 },
				{ model: 'text-embedding-3-small', provider: 'openai', category: 'Embedding', totalCostUsd: 0.0002, inputTokens: 10000 },
				{ model: 'claude-haiku-4-5-20251001', provider: 'anthropic', category: 'Processing', totalCostUsd: 0.0035, inputTokens: 1000, outputTokens: 500 },
			];
			const html = buildCostOverviewHtml(models, 'session', 0.0097);
			assert.ok(html.includes('whisper-1'), 'should contain whisper model');
			assert.ok(html.includes('claude-haiku'), 'should contain claude model');
			assert.ok(html.includes('OpenAI'), 'should contain OpenAI provider group');
			assert.ok(html.includes('Anthropic'), 'should contain Anthropic provider group');
		});

		test('renders empty state when no records', () => {
			const html = buildCostOverviewHtml([], 'session', 0);
			assert.ok(html.includes('No usage'), 'should show empty state message');
		});

		test('uses vscode CSS variables for theming', () => {
			const html = buildCostOverviewHtml([], 'session', 0);
			assert.ok(html.includes('--vscode-'), 'should use VS Code CSS variables');
		});

		test('shows total cost at the bottom', () => {
			const models: AggregatedModel[] = [
				{ model: 'whisper-1', provider: 'openai', category: 'Transcription', totalCostUsd: 0.1, audioDurationSec: 1000 },
			];
			const html = buildCostOverviewHtml(models, 'session', 0.1);
			assert.ok(html.includes('$0.10'), 'should show formatted total cost');
		});
	});
});
```

**Step 2: Create minimal costOverviewPanel.ts for compilation**

Create `src/costOverviewPanel.ts` with exported interface `AggregatedModel` and stub `buildCostOverviewHtml` returning empty string.

**Step 3: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/costOverviewPanel.test.js --ui tdd --timeout 5000`
Expected: FAIL

**Step 4: Implement buildCostOverviewHtml**

Full implementation: builds HTML string with:
- `<style>` block using `--vscode-*` CSS variables
- Provider group headings (OpenAI, Anthropic)
- Card per model with usage details and cost
- Total cost footer
- Toggle buttons (Session / Total) that post messages

**Step 5: Implement CostOverviewPanel class**

The class manages the VS Code WebviewPanel lifecycle:
- `createOrShow(extensionUri, costTracker)` — creates or reveals the panel
- Listens for `postMessage` from WebView (toggle scope)
- `update()` — refreshes HTML with current data from CostTracker
- Aggregates UsageRecords by model into `AggregatedModel[]`

**Step 6: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/costOverviewPanel.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 7: Commit**

```
git add src/costOverviewPanel.ts src/test/unit/costOverviewPanel.test.ts
/commit
```

---

### Task 5: Extension Integration — Wire Everything

**Files:**
- Modify: `src/extension.ts` (import CostTracker, instantiate, wire to services, register command, add WAV duration utility)
- Modify: `package.json` (add `dictation.showCostOverview` command)

**Step 1: Add command to package.json**

In `package.json` `contributes.commands` array (after line 72):
```json
{
  "command": "dictation.showCostOverview",
  "title": "Show Cost Overview",
  "category": "Verba"
}
```

**Step 2: Wire CostTracker in extension.ts**

1. Add imports at top:
```typescript
import { CostTracker } from './costTracker';
import { CostOverviewPanel } from './costOverviewPanel';
```

2. In `activate()`, after line 64 (after creating cleanupService):
```typescript
const costTracker = new CostTracker(context.globalState);
```

3. After Whisper transcription (after line 233, where `rawTranscript` is set):
```typescript
// Track Whisper usage: calculate audio duration from WAV file
const wavDurationSec = getWavDurationSec(filePath);
if (wavDurationSec > 0) {
	costTracker.trackWhisperUsage(wavDurationSec);
}
```

4. After Claude processing (after line 263, where `transcript` is set via processStreaming):
```typescript
if (cleanupService.lastUsage) {
	costTracker.trackClaudeUsage(cleanupService.lastUsage.inputTokens, cleanupService.lastUsage.outputTokens);
}
```

5. Register the command (before the subscriptions push):
```typescript
const showCostOverviewCommand = vscode.commands.registerCommand('dictation.showCostOverview', () => {
	CostOverviewPanel.createOrShow(context.extensionUri, costTracker);
});
```

6. Add `showCostOverviewCommand` to `context.subscriptions.push(...)`.

**Step 3: Add WAV duration utility function**

In `src/extension.ts`, add helper:
```typescript
function getWavDurationSec(wavPath: string): number {
	try {
		const fd = fs.openSync(wavPath, 'r');
		const header = Buffer.alloc(44);
		fs.readSync(fd, header, 0, 44, 0);
		fs.closeSync(fd);
		const byteRate = header.readUInt32LE(28);
		const dataSize = header.readUInt32LE(40);
		if (byteRate === 0) { return 0; }
		return dataSize / byteRate;
	} catch {
		return 0;
	}
}
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS (unit + integration)

**Step 5: Commit**

```
git add src/extension.ts package.json
/commit
```

---

### Task 6: Final Verification and Cleanup

**Step 1: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 2: Compile and bundle**

Run: `npm run bundle`
Expected: No errors

**Step 3: Update CLAUDE.md with new command**

Add `dictation.showCostOverview` to the Conventions section.

**Step 4: Update CHANGELOG.md**

Add entry under Unreleased: "LLM cost tracking and overview WebView (TF-270)"

**Step 5: Commit**

```
git add CLAUDE.md CHANGELOG.md
/commit
```
