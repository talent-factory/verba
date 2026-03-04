import * as assert from 'assert';

import { buildCostOverviewHtml, aggregateRecords, AggregatedModel } from '../../costOverviewPanel';
import { UsageRecord } from '../../costTracker';

suite('CostOverviewPanel', () => {
	suite('buildCostOverviewHtml()', () => {
		test('renders empty state when no models', () => {
			const html = buildCostOverviewHtml([], 'session', 0);

			assert.ok(html.includes('No usage recorded yet.'));
		});

		test('renders cards grouped by provider', () => {
			const models: AggregatedModel[] = [
				{
					model: 'nova-3',
					provider: 'deepgram',
					category: 'Transcription',
					totalCostUsd: 0.006,
					audioDurationSec: 60,
				},
				{
					model: 'claude-haiku-4-5-20251001',
					provider: 'anthropic',
					category: 'Processing',
					totalCostUsd: 0.0035,
					inputTokens: 1000,
					outputTokens: 500,
				},
			];
			const html = buildCostOverviewHtml(models, 'session', 0.0095);

			assert.ok(html.includes('Deepgram'));
			assert.ok(html.includes('Anthropic'));
			assert.ok(html.includes('nova-3'));
			assert.ok(html.includes('claude-haiku-4-5-20251001'));
		});

		test('uses vscode CSS variables', () => {
			const html = buildCostOverviewHtml([], 'session', 0);

			assert.ok(html.includes('--vscode-editor-background'));
			assert.ok(html.includes('--vscode-editor-foreground'));
			assert.ok(html.includes('--vscode-button-background'));
			assert.ok(html.includes('--vscode-button-foreground'));
			assert.ok(html.includes('--vscode-panel-border'));
			assert.ok(html.includes('--vscode-badge-background'));
		});

		test('shows total cost', () => {
			const html = buildCostOverviewHtml([], 'session', 1.2345);

			assert.ok(html.includes('Total: $1.2345'));
		});

		test('shows toggle buttons with active state for session', () => {
			const html = buildCostOverviewHtml([], 'session', 0);

			// Session button should have 'active' class
			assert.ok(html.includes('class="toggle-btn active" onclick="toggleScope(\'session\')">Session</button>'));
			// Total button should not have 'active' class
			assert.ok(html.includes('class="toggle-btn" onclick="toggleScope(\'total\')">Total</button>'));
		});

		test('shows toggle buttons with active state for total', () => {
			const html = buildCostOverviewHtml([], 'total', 0);

			// Session button should not have 'active' class
			assert.ok(html.includes('class="toggle-btn" onclick="toggleScope(\'session\')">Session</button>'));
			// Total button should have 'active' class
			assert.ok(html.includes('class="toggle-btn active" onclick="toggleScope(\'total\')">Total</button>'));
		});

		test('shows audio duration for Deepgram', () => {
			const models: AggregatedModel[] = [
				{
					model: 'nova-3',
					provider: 'deepgram',
					category: 'Transcription',
					totalCostUsd: 0.006,
					audioDurationSec: 150,
				},
			];
			const html = buildCostOverviewHtml(models, 'session', 0.006);

			assert.ok(html.includes('2.5 min audio'));
		});

		test('shows input/output tokens for Claude', () => {
			const models: AggregatedModel[] = [
				{
					model: 'claude-haiku-4-5-20251001',
					provider: 'anthropic',
					category: 'Processing',
					totalCostUsd: 0.0035,
					inputTokens: 1500,
					outputTokens: 300,
				},
			];
			const html = buildCostOverviewHtml(models, 'session', 0.0035);

			assert.ok(html.includes('In: 1,500 tokens'));
			assert.ok(html.includes('Out: 300 tokens'));
		});

		test('shows token count for Embedding', () => {
			const models: AggregatedModel[] = [
				{
					model: 'text-embedding-3-small',
					provider: 'openai',
					category: 'Embedding',
					totalCostUsd: 0.00002,
					inputTokens: 5000,
				},
			];
			const html = buildCostOverviewHtml(models, 'session', 0.00002);

			assert.ok(html.includes('5,000 tokens'));
		});

		test('includes postMessage script', () => {
			const html = buildCostOverviewHtml([], 'session', 0);

			assert.ok(html.includes('acquireVsCodeApi()'));
			assert.ok(html.includes('vscode.postMessage'));
			assert.ok(html.includes("command: 'toggleScope'"));
		});

		test('formats costs with 4 decimal places', () => {
			const models: AggregatedModel[] = [
				{
					model: 'nova-3',
					provider: 'deepgram',
					category: 'Transcription',
					totalCostUsd: 0.1,
					audioDurationSec: 60,
				},
			];
			const html = buildCostOverviewHtml(models, 'session', 0.1);

			assert.ok(html.includes('$0.1000'));
		});
	});

	suite('aggregateRecords()', () => {
		test('empty input returns empty array', () => {
			const result = aggregateRecords([]);

			assert.deepStrictEqual(result, []);
		});

		test('groups multiple records of same model', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 30,
					costUsd: 0.003,
				},
				{
					timestamp: 2000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].model, 'nova-3');
		});

		test('separates records by model', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
				{
					timestamp: 2000,
					model: 'claude-haiku-4-5-20251001',
					provider: 'anthropic',
					inputTokens: 1000,
					outputTokens: 500,
					costUsd: 0.0035,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].model, 'nova-3');
			assert.strictEqual(result[1].model, 'claude-haiku-4-5-20251001');
		});

		test('sums costs correctly', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
				{
					timestamp: 2000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result[0].totalCostUsd, 0.012);
		});

		test('sums tokens correctly', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'claude-haiku-4-5-20251001',
					provider: 'anthropic',
					inputTokens: 500,
					outputTokens: 200,
					costUsd: 0.001,
				},
				{
					timestamp: 2000,
					model: 'claude-haiku-4-5-20251001',
					provider: 'anthropic',
					inputTokens: 300,
					outputTokens: 100,
					costUsd: 0.001,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result[0].inputTokens, 800);
			assert.strictEqual(result[0].outputTokens, 300);
		});

		test('sums audio duration correctly', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 30,
					costUsd: 0.003,
				},
				{
					timestamp: 2000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 90,
					costUsd: 0.009,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result[0].audioDurationSec, 120);
		});

		test('maps model to correct category', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
				{
					timestamp: 2000,
					model: 'text-embedding-3-small',
					provider: 'openai',
					inputTokens: 1000,
					costUsd: 0.00002,
				},
				{
					timestamp: 3000,
					model: 'claude-haiku-4-5-20251001',
					provider: 'anthropic',
					inputTokens: 500,
					outputTokens: 200,
					costUsd: 0.001,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result[0].category, 'Transcription');
			assert.strictEqual(result[1].category, 'Embedding');
			assert.strictEqual(result[2].category, 'Processing');
		});

		test('leaves tokens/audio undefined when not present in records', () => {
			const records: UsageRecord[] = [
				{
					timestamp: 1000,
					model: 'nova-3',
					provider: 'deepgram',
					audioDurationSec: 60,
					costUsd: 0.006,
				},
			];
			const result = aggregateRecords(records);

			assert.strictEqual(result[0].audioDurationSec, 60);
			assert.strictEqual(result[0].inputTokens, undefined);
			assert.strictEqual(result[0].outputTokens, undefined);
		});
	});
});
