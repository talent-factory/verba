/**
 * WebView panel for displaying LLM cost overview.
 * Pure functions (buildCostOverviewHtml, aggregateRecords) are testable without VS Code.
 *
 * The vscode module is imported lazily (inside the CostOverviewPanel class) so that
 * the pure functions can be loaded and tested outside the VS Code extension host.
 */

import type * as vscode from 'vscode';
import { CostTracker, UsageRecord } from './costTracker';

export interface AggregatedModel {
	model: string;
	provider: 'openai' | 'anthropic';
	category: 'Transcription' | 'Embedding' | 'Processing' | 'Unknown';
	totalCostUsd: number;
	inputTokens?: number;
	outputTokens?: number;
	audioDurationSec?: number;
}

const MODEL_CATEGORY_MAP: Record<string, AggregatedModel['category']> = {
	'whisper-1': 'Transcription',
	'text-embedding-3-small': 'Embedding',
	'claude-haiku-4-5-20251001': 'Processing',
};

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

function formatTokens(count: number): string {
	return count.toLocaleString('en-US');
}

function formatAudioDuration(seconds: number): string {
	const minutes = seconds / 60;
	return `${minutes.toFixed(1)} min`;
}

/**
 * Groups UsageRecords by model, summing costs, tokens, and audio duration.
 */
export function aggregateRecords(records: UsageRecord[]): AggregatedModel[] {
	const map = new Map<string, AggregatedModel>();

	for (const record of records) {
		let agg = map.get(record.model);
		if (!agg) {
			agg = {
				model: record.model,
				provider: record.provider,
				category: MODEL_CATEGORY_MAP[record.model] ?? 'Unknown',
				totalCostUsd: 0,
				inputTokens: undefined,
				outputTokens: undefined,
				audioDurationSec: undefined,
			};
			map.set(record.model, agg);
		}

		agg.totalCostUsd += record.costUsd;

		if (record.inputTokens !== undefined) {
			agg.inputTokens = (agg.inputTokens ?? 0) + record.inputTokens;
		}
		if (record.outputTokens !== undefined) {
			agg.outputTokens = (agg.outputTokens ?? 0) + record.outputTokens;
		}
		if (record.audioDurationSec !== undefined) {
			agg.audioDurationSec = (agg.audioDurationSec ?? 0) + record.audioDurationSec;
		}
	}

	return Array.from(map.values());
}

function buildUsageDetails(model: AggregatedModel): string {
	const parts: string[] = [];

	if (model.audioDurationSec !== undefined) {
		parts.push(`${formatAudioDuration(model.audioDurationSec)} audio`);
	} else if (model.category === 'Embedding' && model.inputTokens !== undefined) {
		parts.push(`${formatTokens(model.inputTokens)} tokens`);
	} else {
		if (model.inputTokens !== undefined) {
			parts.push(`In: ${formatTokens(model.inputTokens)} tokens`);
		}
		if (model.outputTokens !== undefined) {
			parts.push(`Out: ${formatTokens(model.outputTokens)} tokens`);
		}
	}

	return parts.map(p => `<div class="usage-detail">${p}</div>`).join('\n');
}

function buildModelCard(model: AggregatedModel): string {
	return `<div class="card">
	<div class="card-model">${model.model}</div>
	<div class="card-category">${model.category}</div>
	<div class="card-usage">${buildUsageDetails(model)}</div>
	<div class="card-cost">${formatCost(model.totalCostUsd)}</div>
</div>`;
}

/**
 * Builds a complete HTML string for the cost overview WebView.
 */
export function buildCostOverviewHtml(
	models: AggregatedModel[],
	scope: 'session' | 'total',
	totalCost: number,
): string {
	const sessionActive = scope === 'session' ? ' active' : '';
	const totalActive = scope === 'total' ? ' active' : '';

	let content: string;
	if (models.length === 0) {
		content = '<div class="empty-state">No usage recorded yet.</div>';
	} else {
		const grouped = new Map<string, AggregatedModel[]>();
		for (const model of models) {
			const providerName = model.provider === 'openai' ? 'OpenAI' : 'Anthropic';
			if (!grouped.has(providerName)) {
				grouped.set(providerName, []);
			}
			grouped.get(providerName)!.push(model);
		}

		const sections: string[] = [];
		for (const [providerName, providerModels] of grouped) {
			const cards = providerModels.map(m => buildModelCard(m)).join('\n');
			sections.push(`<div class="provider-group">
	<div class="provider-heading">${providerName}</div>
	<div class="card-grid">${cards}</div>
</div>`);
		}

		content = sections.join('\n');
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body {
	background-color: var(--vscode-editor-background);
	color: var(--vscode-editor-foreground);
	font-family: var(--vscode-font-family);
	padding: 16px;
	margin: 0;
}
.toggle-bar {
	display: flex;
	gap: 8px;
	margin-bottom: 16px;
}
.toggle-btn {
	padding: 6px 16px;
	border: 1px solid var(--vscode-panel-border);
	background: transparent;
	color: var(--vscode-editor-foreground);
	cursor: pointer;
	border-radius: 4px;
}
.toggle-btn.active {
	background-color: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
}
.empty-state {
	padding: 32px;
	text-align: center;
	opacity: 0.7;
}
.provider-group {
	margin-bottom: 16px;
}
.provider-heading {
	background-color: var(--vscode-badge-background);
	padding: 6px 12px;
	border-radius: 4px;
	font-weight: bold;
	margin-bottom: 8px;
	display: inline-block;
}
.card-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	margin-bottom: 8px;
}
.card {
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	padding: 12px;
}
.card-model {
	font-weight: bold;
	margin-bottom: 4px;
}
.card-category {
	opacity: 0.7;
	font-size: 0.9em;
	margin-bottom: 8px;
}
.card-usage {
	margin-bottom: 8px;
}
.usage-detail {
	font-size: 0.9em;
}
.card-cost {
	font-weight: bold;
	font-size: 1.1em;
}
.total-footer {
	margin-top: 16px;
	padding-top: 12px;
	border-top: 1px solid var(--vscode-panel-border);
	font-size: 1.2em;
	font-weight: bold;
	text-align: right;
}
</style>
</head>
<body>
<div class="toggle-bar">
	<button class="toggle-btn${sessionActive}" onclick="toggleScope('session')">Session</button>
	<button class="toggle-btn${totalActive}" onclick="toggleScope('total')">Total</button>
</div>
${content}
<div class="total-footer">Total: ${formatCost(totalCost)}</div>
<script>
	const vscode = acquireVsCodeApi();
	function toggleScope(scope) {
		vscode.postMessage({ command: 'toggleScope', scope: scope });
	}
</script>
</body>
</html>`;
}

// Lazy-load vscode module so pure functions remain testable outside the extension host.
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getVscode(): typeof import('vscode') { return require('vscode'); }

/**
 * Manages a single WebView panel for the cost overview.
 */
export class CostOverviewPanel {
	private static currentPanel: CostOverviewPanel | undefined;

	private readonly _panel: vscode.WebviewPanel;
	private readonly _costTracker: CostTracker;
	private _scope: 'session' | 'total' = 'session';
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(costTracker: CostTracker): void {
		const vs = getVscode();
		const column = vs.window.activeTextEditor
			? vs.window.activeTextEditor.viewColumn
			: undefined;

		if (CostOverviewPanel.currentPanel) {
			CostOverviewPanel.currentPanel._panel.reveal(column);
			CostOverviewPanel.currentPanel._update();
			return;
		}

		const panel = vs.window.createWebviewPanel(
			'verbaCostOverview',
			'Verba Cost Overview',
			column || vs.ViewColumn.One,
			{ enableScripts: true },
		);

		CostOverviewPanel.currentPanel = new CostOverviewPanel(panel, costTracker);
	}

	private constructor(panel: vscode.WebviewPanel, costTracker: CostTracker) {
		this._panel = panel;
		this._costTracker = costTracker;

		this._update();

		this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(
			(message: { command: string; scope?: string }) => {
				if (message.command === 'toggleScope' && (message.scope === 'session' || message.scope === 'total')) {
					this._scope = message.scope;
					this._update();
				}
			},
			null,
			this._disposables,
		);
	}

	private _update(): void {
		const records = this._scope === 'session'
			? this._costTracker.getSessionRecords()
			: this._costTracker.getTotalRecords();

		const models = aggregateRecords(records);
		const totalCost = this._scope === 'session'
			? this._costTracker.getSessionCosts()
			: this._costTracker.getTotalCosts();

		this._panel.webview.html = buildCostOverviewHtml(models, this._scope, totalCost);
	}

	private _dispose(): void {
		CostOverviewPanel.currentPanel = undefined;

		this._panel.dispose();

		while (this._disposables.length) {
			const d = this._disposables.pop();
			if (d) {
				d.dispose();
			}
		}
	}
}
