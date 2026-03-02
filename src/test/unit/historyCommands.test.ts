import * as assert from 'assert';
import * as sinon from 'sinon';

import { HistoryRecord } from '../../historyManager';
import { buildHistoryItems, buildActionItems, HistoryQuickPickItem, ActionQuickPickItem } from '../../historyCommands';

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

suite('historyCommands', () => {
	let clock: sinon.SinonFakeTimers;

	teardown(() => {
		if (clock) {
			clock.restore();
		}
		sinon.restore();
	});

	suite('buildHistoryItems', () => {
		test('builds items from records with correct structure', () => {
			const now = Date.now();
			clock = sinon.useFakeTimers(now);

			const records: HistoryRecord[] = [
				createRecord({
					timestamp: now - 30_000,
					cleanedText: 'Hello world.',
					rawTranscript: 'hello world',
					templateName: 'Default Cleanup',
				}),
			];

			const items = buildHistoryItems(records);

			assert.strictEqual(items.length, 1);
			assert.ok(items[0].label.includes('just now'));
			assert.ok(items[0].label.includes('Default Cleanup'));
			assert.strictEqual(items[0].description, 'Hello world.');
			assert.strictEqual(items[0].detail, 'hello world');
			assert.strictEqual(items[0].record, records[0]);
		});

		test('label uses clock icon and relative time with template name', () => {
			const now = Date.now();
			clock = sinon.useFakeTimers(now);

			const records: HistoryRecord[] = [
				createRecord({
					timestamp: now - 5 * 60_000,
					templateName: 'Commit Message',
					cleanedText: 'Fix bug.',
					rawTranscript: 'fix bug',
				}),
			];

			const items = buildHistoryItems(records);
			assert.strictEqual(items[0].label, '$(clock) 5 min ago \u00B7 Commit Message');
		});

		test('truncates long cleanedText description at 80 chars', () => {
			const now = Date.now();
			clock = sinon.useFakeTimers(now);

			const longText = 'A'.repeat(120);
			const records: HistoryRecord[] = [
				createRecord({ timestamp: now - 1000, cleanedText: longText }),
			];

			const items = buildHistoryItems(records);
			assert.strictEqual(items[0].description!.length, 80);
			assert.ok(items[0].description!.endsWith('\u2026'));
		});

		test('truncates long rawTranscript detail at 80 chars', () => {
			const now = Date.now();
			clock = sinon.useFakeTimers(now);

			const longText = 'B'.repeat(120);
			const records: HistoryRecord[] = [
				createRecord({ timestamp: now - 1000, rawTranscript: longText }),
			];

			const items = buildHistoryItems(records);
			assert.strictEqual(items[0].detail!.length, 80);
			assert.ok(items[0].detail!.endsWith('\u2026'));
		});

		test('does not truncate text at exactly 80 chars', () => {
			const now = Date.now();
			clock = sinon.useFakeTimers(now);

			const exactText = 'C'.repeat(80);
			const records: HistoryRecord[] = [
				createRecord({ timestamp: now - 1000, cleanedText: exactText }),
			];

			const items = buildHistoryItems(records);
			assert.strictEqual(items[0].description, exactText);
		});

		test('returns empty array for empty records', () => {
			const items = buildHistoryItems([]);
			assert.deepStrictEqual(items, []);
		});

		test('builds multiple items preserving order', () => {
			const now = Date.now();
			clock = sinon.useFakeTimers(now);

			const records: HistoryRecord[] = [
				createRecord({ timestamp: now - 1000, cleanedText: 'First.' }),
				createRecord({ timestamp: now - 2000, cleanedText: 'Second.' }),
				createRecord({ timestamp: now - 3000, cleanedText: 'Third.' }),
			];

			const items = buildHistoryItems(records);
			assert.strictEqual(items.length, 3);
			assert.strictEqual(items[0].description, 'First.');
			assert.strictEqual(items[1].description, 'Second.');
			assert.strictEqual(items[2].description, 'Third.');
		});
	});

	suite('buildActionItems', () => {
		test('returns exactly 3 items', () => {
			const items = buildActionItems();
			assert.strictEqual(items.length, 3);
		});

		test('returns insert, copy, and details actions', () => {
			const items = buildActionItems();
			const ids = items.map(i => i.id);
			assert.deepStrictEqual(ids, ['insert', 'copy', 'details']);
		});

		test('insert item has correct icon', () => {
			const items = buildActionItems();
			const insert = items.find(i => i.id === 'insert')!;
			assert.ok(insert.label.includes('$(insert)'));
		});

		test('copy item has correct icon', () => {
			const items = buildActionItems();
			const copy = items.find(i => i.id === 'copy')!;
			assert.ok(copy.label.includes('$(clippy)'));
		});

		test('details item has correct icon', () => {
			const items = buildActionItems();
			const details = items.find(i => i.id === 'details')!;
			assert.ok(details.label.includes('$(info)'));
		});
	});
});
