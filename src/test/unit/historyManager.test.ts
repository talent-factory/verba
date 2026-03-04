import * as assert from 'assert';
import * as sinon from 'sinon';

import { HistoryManager, HistoryRecord, GlobalState, formatRelativeTime } from '../../historyManager';

function createFakeGlobalState(initialRecords: HistoryRecord[] = []): GlobalState & { get: sinon.SinonStub; update: sinon.SinonStub } {
	return {
		get: sinon.stub().returns(initialRecords),
		update: sinon.stub().resolves(),
	};
}

function createRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
	return {
		id: overrides.id ?? `${Date.now()}-0`,
		timestamp: overrides.timestamp ?? Date.now(),
		rawTranscript: overrides.rawTranscript ?? 'raw transcript',
		cleanedText: overrides.cleanedText ?? 'cleaned text',
		templateName: overrides.templateName ?? 'Default Cleanup',
		target: overrides.target ?? 'editor',
		languageId: overrides.languageId,
		workspaceFolder: overrides.workspaceFolder,
	};
}

suite('HistoryManager', () => {
	let manager: HistoryManager;
	let globalState: ReturnType<typeof createFakeGlobalState>;

	setup(() => {
		globalState = createFakeGlobalState();
		manager = new HistoryManager(globalState);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('addRecord', () => {
		test('adds a record and persists to globalState', async () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'hello world',
				cleanedText: 'Hello world.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			// Flush the serialized persist queue (runs in next microtask)
			await new Promise(resolve => setImmediate(resolve));

			assert.strictEqual(manager.getRecordCount(), 1);
			assert.ok(globalState.update.calledOnce);
			assert.strictEqual(globalState.update.firstCall.args[0], 'verba.history');

			const persisted = globalState.update.firstCall.args[1] as HistoryRecord[];
			assert.strictEqual(persisted.length, 1);
			assert.strictEqual(persisted[0].rawTranscript, 'hello world');
			assert.strictEqual(persisted[0].cleanedText, 'Hello world.');
		});

		test('generates unique IDs for each record', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'first',
				cleanedText: 'First.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			manager.addRecord({
				timestamp: 2000,
				rawTranscript: 'second',
				cleanedText: 'Second.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			const records = manager.getRecords();
			assert.strictEqual(records.length, 2);
			assert.notStrictEqual(records[0].id, records[1].id);
		});

		test('returns records newest first', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'older',
				cleanedText: 'Older.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			manager.addRecord({
				timestamp: 2000,
				rawTranscript: 'newer',
				cleanedText: 'Newer.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			const records = manager.getRecords();
			assert.strictEqual(records[0].rawTranscript, 'newer');
			assert.strictEqual(records[1].rawTranscript, 'older');
		});

		test('FIFO prunes when exceeding maxEntries', () => {
			const smallManager = new HistoryManager(globalState, 3);

			for (let i = 0; i < 5; i++) {
				smallManager.addRecord({
					timestamp: i * 1000,
					rawTranscript: `entry ${i}`,
					cleanedText: `Entry ${i}.`,
					templateName: 'Default Cleanup',
					target: 'editor',
				});
			}

			assert.strictEqual(smallManager.getRecordCount(), 3);
			const records = smallManager.getRecords();
			// Newest first, oldest pruned
			assert.strictEqual(records[0].rawTranscript, 'entry 4');
			assert.strictEqual(records[1].rawTranscript, 'entry 3');
			assert.strictEqual(records[2].rawTranscript, 'entry 2');
		});

		test('preserves optional fields', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'test',
				cleanedText: 'Test.',
				templateName: 'JavaDoc',
				target: 'editor',
				languageId: 'java',
				workspaceFolder: '/workspace/project',
			});

			const record = manager.getRecords()[0];
			assert.strictEqual(record.languageId, 'java');
			assert.strictEqual(record.workspaceFolder, '/workspace/project');
			assert.strictEqual(record.templateName, 'JavaDoc');
		});

		test('preserves target field for terminal', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'ls -la',
				cleanedText: 'ls -la',
				templateName: 'Terminal Command',
				target: 'terminal',
			});

			const record = manager.getRecords()[0];
			assert.strictEqual(record.target, 'terminal');
		});
	});

	suite('searchRecords', () => {
		setup(() => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'implement the login feature',
				cleanedText: 'Implement the authentication module.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			manager.addRecord({
				timestamp: 2000,
				rawTranscript: 'write unit tests for parser',
				cleanedText: 'Write unit tests for the parser module.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			manager.addRecord({
				timestamp: 3000,
				rawTranscript: 'fix the authentication bug',
				cleanedText: 'Fix the login validation error.',
				templateName: 'Commit Message',
				target: 'editor',
			});
		});

		test('matches on cleanedText', () => {
			const results = manager.searchRecords('parser module');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].cleanedText, 'Write unit tests for the parser module.');
		});

		test('matches on rawTranscript', () => {
			const results = manager.searchRecords('login feature');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].rawTranscript, 'implement the login feature');
		});

		test('case-insensitive matching', () => {
			const results = manager.searchRecords('AUTHENTICATION');
			assert.strictEqual(results.length, 2);
		});

		test('returns empty array when no match', () => {
			const results = manager.searchRecords('database migration');
			assert.deepStrictEqual(results, []);
		});

		test('returns results newest first', () => {
			const results = manager.searchRecords('authentication');
			assert.strictEqual(results.length, 2);
			// Record with timestamp 3000 (cleanedText matches) comes first
			assert.strictEqual(results[0].timestamp, 3000);
			// Record with timestamp 1000 (cleanedText matches) comes second
			assert.strictEqual(results[1].timestamp, 1000);
		});
	});

	suite('clearHistory', () => {
		test('removes all records', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'test',
				cleanedText: 'Test.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			manager.clearHistory();

			assert.strictEqual(manager.getRecordCount(), 0);
			assert.deepStrictEqual(manager.getRecords(), []);
		});

		test('persists empty array to globalState', async () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'test',
				cleanedText: 'Test.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			await new Promise(resolve => setImmediate(resolve));
			globalState.update.resetHistory();

			manager.clearHistory();
			await new Promise(resolve => setImmediate(resolve));

			assert.ok(globalState.update.calledOnce);
			assert.strictEqual(globalState.update.firstCall.args[0], 'verba.history');
			assert.deepStrictEqual(globalState.update.firstCall.args[1], []);
		});
	});

	suite('getRecordCount', () => {
		test('returns 0 for empty history', () => {
			assert.strictEqual(manager.getRecordCount(), 0);
		});

		test('returns correct count after adding records', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'first',
				cleanedText: 'First.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			manager.addRecord({
				timestamp: 2000,
				rawTranscript: 'second',
				cleanedText: 'Second.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			assert.strictEqual(manager.getRecordCount(), 2);
		});

		test('returns 0 after clearing history', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'test',
				cleanedText: 'Test.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			manager.clearHistory();

			assert.strictEqual(manager.getRecordCount(), 0);
		});
	});

	suite('constructor validation', () => {
		test('loads valid records from globalState', () => {
			const existingRecords: HistoryRecord[] = [
				createRecord({ id: '1-0', rawTranscript: 'existing' }),
			];
			globalState = createFakeGlobalState(existingRecords);
			manager = new HistoryManager(globalState);

			assert.strictEqual(manager.getRecordCount(), 1);
			assert.strictEqual(manager.getRecords()[0].rawTranscript, 'existing');
		});

		test('filters out invalid records missing required fields', () => {
			const mixedRecords = [
				createRecord({ id: '1-0', rawTranscript: 'valid' }),
				{ id: '2-0', timestamp: 1000 },  // missing rawTranscript, cleanedText, etc.
				{ notARecord: true },             // completely invalid
				createRecord({ id: '3-0', rawTranscript: 'also valid' }),
			];
			globalState = createFakeGlobalState(mixedRecords as any);
			manager = new HistoryManager(globalState);

			assert.strictEqual(manager.getRecordCount(), 2);
			const records = manager.getRecords();
			assert.strictEqual(records[0].rawTranscript, 'also valid');
			assert.strictEqual(records[1].rawTranscript, 'valid');
		});

		test('handles non-array stored data gracefully', () => {
			globalState = createFakeGlobalState();
			globalState.get.returns('not an array');
			manager = new HistoryManager(globalState);

			assert.strictEqual(manager.getRecordCount(), 0);
		});

		test('reads from correct storage key', () => {
			globalState = createFakeGlobalState();
			manager = new HistoryManager(globalState);

			assert.ok(globalState.get.calledOnce);
			assert.strictEqual(globalState.get.firstCall.args[0], 'verba.history');
			assert.deepStrictEqual(globalState.get.firstCall.args[1], []);
		});
	});

	suite('getRecords', () => {
		test('returns a copy, not the internal array', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'test',
				cleanedText: 'Test.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

			const records1 = manager.getRecords();
			const records2 = manager.getRecords();
			assert.notStrictEqual(records1, records2);
			assert.deepStrictEqual(records1, records2);
		});
	});
});

suite('formatRelativeTime', () => {
	let clock: sinon.SinonFakeTimers;

	teardown(() => {
		if (clock) {
			clock.restore();
		}
	});

	test('returns "just now" for timestamps less than 60 seconds ago', () => {
		const now = Date.now();
		clock = sinon.useFakeTimers(now);
		assert.strictEqual(formatRelativeTime(now - 30_000), 'just now');
		assert.strictEqual(formatRelativeTime(now - 1_000), 'just now');
		assert.strictEqual(formatRelativeTime(now), 'just now');
	});

	test('returns "just now" at exactly 59 seconds ago', () => {
		const now = Date.now();
		clock = sinon.useFakeTimers(now);
		assert.strictEqual(formatRelativeTime(now - 59_000), 'just now');
	});

	test('returns "N min ago" for timestamps less than 60 minutes ago', () => {
		const now = Date.now();
		clock = sinon.useFakeTimers(now);
		assert.strictEqual(formatRelativeTime(now - 60_000), '1 min ago');
		assert.strictEqual(formatRelativeTime(now - 5 * 60_000), '5 min ago');
		assert.strictEqual(formatRelativeTime(now - 59 * 60_000), '59 min ago');
	});

	test('returns "HH:MM" for earlier today', () => {
		// Fix "now" to 15:30 on a specific day
		const today = new Date(2025, 5, 15, 15, 30, 0); // June 15 2025, 15:30:00
		clock = sinon.useFakeTimers(today.getTime());

		// A timestamp from 08:05 today (more than 60 min ago)
		const morning = new Date(2025, 5, 15, 8, 5, 0).getTime();
		assert.strictEqual(formatRelativeTime(morning), '08:05');
	});

	test('returns zero-padded "HH:MM" for single-digit hours/minutes', () => {
		const today = new Date(2025, 5, 15, 15, 30, 0);
		clock = sinon.useFakeTimers(today.getTime());

		const earlyMorning = new Date(2025, 5, 15, 1, 3, 0).getTime();
		assert.strictEqual(formatRelativeTime(earlyMorning), '01:03');
	});

	test('returns "Yesterday HH:MM" for timestamps from yesterday', () => {
		const today = new Date(2025, 5, 15, 10, 0, 0); // June 15 2025, 10:00
		clock = sinon.useFakeTimers(today.getTime());

		const yesterday = new Date(2025, 5, 14, 18, 45, 0).getTime();
		assert.strictEqual(formatRelativeTime(yesterday), 'Yesterday 18:45');
	});

	test('returns "Yesterday HH:MM" for yesterday early morning', () => {
		const today = new Date(2025, 5, 15, 10, 0, 0); // June 15 2025, 10:00
		clock = sinon.useFakeTimers(today.getTime());

		const yesterdayEarly = new Date(2025, 5, 14, 0, 15, 0).getTime();
		assert.strictEqual(formatRelativeTime(yesterdayEarly), 'Yesterday 00:15');
	});

	test('returns "YYYY-MM-DD" for timestamps older than yesterday', () => {
		const today = new Date(2025, 5, 15, 10, 0, 0);
		clock = sinon.useFakeTimers(today.getTime());

		const twoDaysAgo = new Date(2025, 5, 13, 14, 30, 0).getTime();
		assert.strictEqual(formatRelativeTime(twoDaysAgo), '2025-06-13');
	});

	test('returns "YYYY-MM-DD" with zero-padded month and day', () => {
		const today = new Date(2025, 5, 15, 10, 0, 0);
		clock = sinon.useFakeTimers(today.getTime());

		const oldDate = new Date(2025, 0, 5, 12, 0, 0).getTime(); // Jan 5
		assert.strictEqual(formatRelativeTime(oldDate), '2025-01-05');
	});
});
