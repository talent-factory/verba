import * as assert from 'assert';
import * as sinon from 'sinon';

import { HistoryManager, HistoryRecord, GlobalState } from '../../historyManager';

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
		test('adds a record and persists to globalState', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'hello world',
				cleanedText: 'Hello world.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});

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

		test('persists empty array to globalState', () => {
			manager.addRecord({
				timestamp: 1000,
				rawTranscript: 'test',
				cleanedText: 'Test.',
				templateName: 'Default Cleanup',
				target: 'editor',
			});
			globalState.update.resetHistory();

			manager.clearHistory();

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
