import * as assert from 'assert';
import * as sinon from 'sinon';

import { CostTracker, UsageRecord, GlobalState } from '../../costTracker';

function createFakeGlobalState(initialRecords: UsageRecord[] = []): GlobalState & { get: sinon.SinonStub; update: sinon.SinonStub } {
	return {
		get: sinon.stub().returns(initialRecords),
		update: sinon.stub().resolves(),
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

	suite('trackWhisperUsage', () => {
		test('calculates cost correctly for 60 seconds of audio', () => {
			tracker.trackWhisperUsage(60);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].costUsd, 0.006);
		});

		test('calculates cost correctly for 30 seconds of audio', () => {
			tracker.trackWhisperUsage(30);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].costUsd, 0.003);
		});

		test('calculates cost correctly for 90 seconds of audio', () => {
			tracker.trackWhisperUsage(90);

			const records = tracker.getSessionRecords();
			// Use approximate comparison to handle floating-point precision
			const expected = (90 / 60) * 0.006;
			assert.strictEqual(records[0].costUsd, expected);
		});

		test('creates record with correct fields', () => {
			tracker.trackWhisperUsage(120);

			const record = tracker.getSessionRecords()[0];
			assert.strictEqual(record.model, 'whisper-1');
			assert.strictEqual(record.provider, 'openai');
			assert.strictEqual(record.audioDurationSec, 120);
			assert.strictEqual(record.inputTokens, undefined);
			assert.strictEqual(record.outputTokens, undefined);
			assert.ok(record.timestamp > 0);
		});

		test('persists to globalState on each call', () => {
			tracker.trackWhisperUsage(60);

			assert.ok(globalState.update.calledOnce);
			assert.strictEqual(globalState.update.firstCall.args[0], 'verba.costRecords');
			const persisted = globalState.update.firstCall.args[1] as UsageRecord[];
			assert.strictEqual(persisted.length, 1);
			assert.strictEqual(persisted[0].model, 'whisper-1');
		});
	});

	suite('trackClaudeUsage', () => {
		test('calculates cost correctly for input and output tokens', () => {
			tracker.trackClaudeUsage(1000, 500);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			// cost = 1000/1_000_000 * 1.00 + 500/1_000_000 * 5.00
			// = 0.001 + 0.0025 = 0.0035
			const expected = (1000 / 1_000_000) * 1.0 + (500 / 1_000_000) * 5.0;
			assert.strictEqual(records[0].costUsd, expected);
		});

		test('calculates cost correctly for 1M input tokens and 0 output tokens', () => {
			tracker.trackClaudeUsage(1_000_000, 0);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records[0].costUsd, 1.0);
		});

		test('calculates cost correctly for 0 input tokens and 1M output tokens', () => {
			tracker.trackClaudeUsage(0, 1_000_000);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records[0].costUsd, 5.0);
		});

		test('creates record with correct fields', () => {
			tracker.trackClaudeUsage(500, 200);

			const record = tracker.getSessionRecords()[0];
			assert.strictEqual(record.model, 'claude-haiku-4-5-20251001');
			assert.strictEqual(record.provider, 'anthropic');
			assert.strictEqual(record.inputTokens, 500);
			assert.strictEqual(record.outputTokens, 200);
			assert.strictEqual(record.audioDurationSec, undefined);
			assert.ok(record.timestamp > 0);
		});

		test('persists to globalState on each call', () => {
			tracker.trackClaudeUsage(100, 50);

			assert.ok(globalState.update.calledOnce);
			assert.strictEqual(globalState.update.firstCall.args[0], 'verba.costRecords');
		});
	});

	suite('trackEmbeddingUsage', () => {
		test('calculates cost correctly for prompt tokens', () => {
			tracker.trackEmbeddingUsage(1_000_000);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].costUsd, 0.020);
		});

		test('calculates cost correctly for small number of tokens', () => {
			tracker.trackEmbeddingUsage(1000);

			const records = tracker.getSessionRecords();
			// cost = 1000 / 1_000_000 * 0.020 = 0.00002
			assert.strictEqual(records[0].costUsd, (1000 / 1_000_000) * 0.020);
		});

		test('creates record with correct fields', () => {
			tracker.trackEmbeddingUsage(5000);

			const record = tracker.getSessionRecords()[0];
			assert.strictEqual(record.model, 'text-embedding-3-small');
			assert.strictEqual(record.provider, 'openai');
			assert.strictEqual(record.inputTokens, 5000);
			assert.strictEqual(record.outputTokens, undefined);
			assert.strictEqual(record.audioDurationSec, undefined);
			assert.ok(record.timestamp > 0);
		});

		test('persists to globalState on each call', () => {
			tracker.trackEmbeddingUsage(100);

			assert.ok(globalState.update.calledOnce);
			assert.strictEqual(globalState.update.firstCall.args[0], 'verba.costRecords');
		});
	});

	suite('getSessionCosts', () => {
		test('returns 0 for empty session', () => {
			assert.strictEqual(tracker.getSessionCosts(), 0);
		});

		test('sums multiple session records', () => {
			tracker.trackWhisperUsage(60);   // 0.006
			tracker.trackClaudeUsage(1_000_000, 0); // 1.00
			tracker.trackEmbeddingUsage(1_000_000);  // 0.020

			assert.strictEqual(tracker.getSessionCosts(), 0.006 + 1.0 + 0.020);
		});

		test('does not include previous session records', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			assert.strictEqual(tracker.getSessionCosts(), 0);

			tracker.trackWhisperUsage(60);
			assert.strictEqual(tracker.getSessionCosts(), 0.006);
		});
	});

	suite('getTotalCosts', () => {
		test('returns 0 when no records exist', () => {
			assert.strictEqual(tracker.getTotalCosts(), 0);
		});

		test('includes only session records when no previous data', () => {
			tracker.trackWhisperUsage(60);

			assert.strictEqual(tracker.getTotalCosts(), 0.006);
		});

		test('includes both previous session and current session records', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 120,
				costUsd: 0.012,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			tracker.trackWhisperUsage(60); // 0.006

			assert.strictEqual(tracker.getTotalCosts(), 0.012 + 0.006);
		});

		test('excludes costs from previous months', () => {
			const lastMonth = new Date();
			lastMonth.setMonth(lastMonth.getMonth() - 1);

			const previousRecords: UsageRecord[] = [{
				timestamp: lastMonth.getTime(),
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 120,
				costUsd: 0.012,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			tracker.trackWhisperUsage(60); // 0.006

			assert.strictEqual(tracker.getTotalCosts(), 0.006);
		});
	});

	suite('getSessionRecords', () => {
		test('returns empty array for new session', () => {
			assert.deepStrictEqual(tracker.getSessionRecords(), []);
		});

		test('returns all session records in order', () => {
			tracker.trackWhisperUsage(60);
			tracker.trackClaudeUsage(100, 50);

			const records = tracker.getSessionRecords();
			assert.strictEqual(records.length, 2);
			assert.strictEqual(records[0].model, 'whisper-1');
			assert.strictEqual(records[1].model, 'claude-haiku-4-5-20251001');
		});
	});

	suite('getTotalRecords', () => {
		test('returns empty array when no records exist at all', () => {
			assert.deepStrictEqual(tracker.getTotalRecords(), []);
		});

		test('returns only previous records when session is empty', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			const records = tracker.getTotalRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].costUsd, 0.006);
		});

		test('returns combined previous and session records', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			tracker.trackClaudeUsage(100, 50);

			const records = tracker.getTotalRecords();
			assert.strictEqual(records.length, 2);
			assert.strictEqual(records[0].model, 'whisper-1');
			assert.strictEqual(records[1].model, 'claude-haiku-4-5-20251001');
		});

		test('excludes records from previous months', () => {
			const lastMonth = new Date();
			lastMonth.setMonth(lastMonth.getMonth() - 1);

			const previousRecords: UsageRecord[] = [
				{
					timestamp: lastMonth.getTime(),
					model: 'whisper-1',
					provider: 'openai',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
				{
					timestamp: Date.now() - 100000,
					model: 'whisper-1',
					provider: 'openai',
					audioDurationSec: 30,
					costUsd: 0.003,
				},
			];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			const records = tracker.getTotalRecords();
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].costUsd, 0.003);
		});
	});

	suite('resetTotalCosts', () => {
		test('clears session records', () => {
			tracker.trackWhisperUsage(60);
			tracker.trackClaudeUsage(100, 50);

			tracker.resetTotalCosts();

			assert.deepStrictEqual(tracker.getSessionRecords(), []);
			assert.strictEqual(tracker.getSessionCosts(), 0);
		});

		test('clears globalState', () => {
			tracker.trackWhisperUsage(60);
			globalState.update.resetHistory();

			tracker.resetTotalCosts();

			assert.ok(globalState.update.calledOnce);
			assert.strictEqual(globalState.update.firstCall.args[0], 'verba.costRecords');
			assert.deepStrictEqual(globalState.update.firstCall.args[1], []);
		});

		test('clears both previous and session records from totals', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 100000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			tracker.trackClaudeUsage(100, 50);
			tracker.resetTotalCosts();

			assert.strictEqual(tracker.getTotalCosts(), 0);
			assert.deepStrictEqual(tracker.getTotalRecords(), []);
		});
	});

	suite('persistence', () => {
		test('loads existing records from globalState on construction', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 50000,
				model: 'claude-haiku-4-5-20251001',
				provider: 'anthropic',
				inputTokens: 500,
				outputTokens: 200,
				costUsd: 0.0015,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			assert.ok(globalState.get.calledOnce);
			assert.strictEqual(globalState.get.firstCall.args[0], 'verba.costRecords');
			assert.deepStrictEqual(globalState.get.firstCall.args[1], []);
		});

		test('persists combined previous + session records on each track call', () => {
			const previousRecords: UsageRecord[] = [{
				timestamp: Date.now() - 50000,
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			tracker.trackWhisperUsage(30);

			const persisted = globalState.update.firstCall.args[1] as UsageRecord[];
			assert.strictEqual(persisted.length, 2);
			assert.strictEqual(persisted[0].costUsd, 0.006);      // previous
			assert.strictEqual(persisted[1].audioDurationSec, 30); // new session
		});

		test('persists records from previous months in globalState', () => {
			const lastMonth = new Date();
			lastMonth.setMonth(lastMonth.getMonth() - 1);

			const previousRecords: UsageRecord[] = [{
				timestamp: lastMonth.getTime(),
				model: 'whisper-1',
				provider: 'openai',
				audioDurationSec: 60,
				costUsd: 0.006,
			}];
			globalState = createFakeGlobalState(previousRecords);
			tracker = new CostTracker(globalState);

			tracker.trackWhisperUsage(30);

			const persisted = globalState.update.firstCall.args[1] as UsageRecord[];
			assert.strictEqual(persisted.length, 2);
			assert.strictEqual(persisted[0].timestamp, lastMonth.getTime());
			assert.strictEqual(persisted[1].audioDurationSec, 30);
		});

		test('persists after each individual track call', () => {
			tracker.trackWhisperUsage(60);
			tracker.trackClaudeUsage(100, 50);
			tracker.trackEmbeddingUsage(1000);

			assert.strictEqual(globalState.update.callCount, 3);

			// After the third call, all 3 records should be persisted
			const thirdCallRecords = globalState.update.thirdCall.args[1] as UsageRecord[];
			assert.strictEqual(thirdCallRecords.length, 3);
		});
	});
});
