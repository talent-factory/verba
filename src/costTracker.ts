/**
 * Tracks API usage costs for Deepgram, Claude, and embedding models.
 * Persists cost records via a KeyValueStore for cross-session totals.
 */

import { KeyValueStore, Notifier } from './core/adapters';

const STORAGE_KEY = 'verba.costRecords';

// Pricing as of 2026-03 — verify at https://deepgram.com/pricing and https://www.anthropic.com/pricing
// These model names (nova-3, claude-haiku-4-5-20251001, text-embedding-3-small) must match
// the models used in transcriptionService.ts, cleanupService.ts, and embeddingService.ts.
const DEEPGRAM_COST_PER_MINUTE = 0.0043;      // Deepgram Nova-3: $0.0043/min
const CLAUDE_INPUT_COST_PER_MILLION = 1.00;    // Claude Haiku 4.5: $1.00/1M input tokens
const CLAUDE_OUTPUT_COST_PER_MILLION = 5.00;   // Claude Haiku 4.5: $5.00/1M output tokens
const EMBEDDING_COST_PER_MILLION = 0.020;      // text-embedding-3-small: $0.020/1M tokens

export interface UsageRecord {
	timestamp: number;
	model: string;
	provider: 'openai' | 'anthropic' | 'deepgram';
	inputTokens?: number;
	outputTokens?: number;
	audioDurationSec?: number;
	costUsd: number;
}

/** @deprecated Use {@link KeyValueStore} from ./core/adapters. Retained as an alias for compatibility. */
export type GlobalState = KeyValueStore;

export class CostTracker {
	private readonly _globalState: KeyValueStore;
	private readonly _notifier?: Notifier;
	private _previousRecords: UsageRecord[];
	private _sessionRecords: UsageRecord[] = [];
	private _persistFailureWarned = false;

	constructor(globalState: KeyValueStore, notifier?: Notifier) {
		this._globalState = globalState;
		this._notifier = notifier;
		const raw = globalState.get<unknown[]>(STORAGE_KEY, []);
		this._previousRecords = (Array.isArray(raw) ? raw : []).filter(
			(r): r is UsageRecord =>
				typeof (r as any)?.costUsd === 'number'
				&& typeof (r as any)?.timestamp === 'number'
				&& typeof (r as any)?.model === 'string'
				&& ((r as any)?.provider === 'openai' || (r as any)?.provider === 'anthropic' || (r as any)?.provider === 'deepgram'),
		);
	}

	trackDeepgramUsage(audioDurationSec: number): void {
		const costUsd = (audioDurationSec / 60) * DEEPGRAM_COST_PER_MINUTE;
		const record: UsageRecord = {
			timestamp: Date.now(),
			model: 'nova-3',
			provider: 'deepgram',
			audioDurationSec,
			costUsd,
		};
		this._sessionRecords.push(record);
		this._persist();
	}

	trackClaudeUsage(inputTokens: number, outputTokens: number): void {
		const costUsd =
			(inputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_MILLION +
			(outputTokens / 1_000_000) * CLAUDE_OUTPUT_COST_PER_MILLION;
		const record: UsageRecord = {
			timestamp: Date.now(),
			model: 'claude-haiku-4-5-20251001',
			provider: 'anthropic',
			inputTokens,
			outputTokens,
			costUsd,
		};
		this._sessionRecords.push(record);
		this._persist();
	}

	trackEmbeddingUsage(promptTokens: number): void {
		const costUsd = (promptTokens / 1_000_000) * EMBEDDING_COST_PER_MILLION;
		const record: UsageRecord = {
			timestamp: Date.now(),
			model: 'text-embedding-3-small',
			provider: 'openai',
			inputTokens: promptTokens,
			costUsd,
		};
		this._sessionRecords.push(record);
		this._persist();
	}

	getSessionCosts(): number {
		return this._sessionRecords.reduce((sum, r) => sum + r.costUsd, 0);
	}

	getTotalCosts(): number {
		return this.getTotalRecords().reduce((sum, r) => sum + r.costUsd, 0);
	}

	getSessionRecords(): UsageRecord[] {
		return [...this._sessionRecords];
	}

	/**
	 * Returns records from the current calendar month only.
	 * Records older than 6 months are pruned from storage during persist.
	 * Records between 1-6 months old are retained in storage but excluded
	 * from the returned array and from {@link getTotalCosts}.
	 */
	getTotalRecords(): UsageRecord[] {
		return this._allRecords().filter(r => this._isCurrentMonth(r.timestamp));
	}

	resetTotalCosts(): void {
		this._previousRecords = [];
		this._sessionRecords = [];
		Promise.resolve(this._globalState.update(STORAGE_KEY, []))
			.catch((err: unknown) => {
				console.error('[Verba] Failed to reset cost records:', err);
				this._notifier?.warn('Verba: Failed to reset cost records. Cost data may be stale.');
			});
	}

	private _allRecords(): UsageRecord[] {
		return [...this._previousRecords, ...this._sessionRecords];
	}

	private _isCurrentMonth(timestamp: number): boolean {
		const now = new Date();
		const date = new Date(timestamp);
		return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
	}

	private _persist(): void {
		// Prune records older than 6 months to prevent unbounded storage growth
		const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);
		const records = this._allRecords().filter(r => r.timestamp > sixMonthsAgo);
		Promise.resolve(this._globalState.update(STORAGE_KEY, records))
			.then(() => {
				this._persistFailureWarned = false;
			})
			.catch((err: unknown) => {
				console.error('[Verba] Failed to persist cost records:', err);
				if (!this._persistFailureWarned) {
					this._persistFailureWarned = true;
					this._notifier?.warn('Verba: Failed to save cost records. Usage data for this session may be lost.');
				}
			});
	}
}
