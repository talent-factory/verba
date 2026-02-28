/**
 * Tracks API usage costs for Whisper, Claude, and embedding models.
 * Persists cost records via VS Code globalState for cross-session totals.
 */

const STORAGE_KEY = 'verba.costRecords';

// Pricing as of 2026-02 — verify at https://openai.com/pricing and https://www.anthropic.com/pricing
// These rates must match the models used in transcriptionService.ts, cleanupService.ts and embeddingService.ts.
const WHISPER_COST_PER_MINUTE = 0.006;        // OpenAI Whisper: $0.006/min
const CLAUDE_INPUT_COST_PER_MILLION = 1.00;    // Claude Haiku 4.5: $1.00/1M input tokens
const CLAUDE_OUTPUT_COST_PER_MILLION = 5.00;   // Claude Haiku 4.5: $5.00/1M output tokens
const EMBEDDING_COST_PER_MILLION = 0.020;      // text-embedding-3-small: $0.020/1M tokens

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

// Lazy-load vscode module so CostTracker remains testable outside the extension host.
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getVscode(): typeof import('vscode') { return require('vscode'); }

export class CostTracker {
	private readonly _globalState: GlobalState;
	private _previousRecords: UsageRecord[];
	private _sessionRecords: UsageRecord[] = [];
	private _persistFailureWarned = false;

	constructor(globalState: GlobalState) {
		this._globalState = globalState;
		const raw = globalState.get<unknown[]>(STORAGE_KEY, []);
		this._previousRecords = (Array.isArray(raw) ? raw : []).filter(
			(r): r is UsageRecord =>
				typeof (r as any)?.costUsd === 'number'
				&& typeof (r as any)?.timestamp === 'number'
				&& typeof (r as any)?.model === 'string',
		);
	}

	trackWhisperUsage(audioDurationSec: number): void {
		const costUsd = (audioDurationSec / 60) * WHISPER_COST_PER_MINUTE;
		const record: UsageRecord = {
			timestamp: Date.now(),
			model: 'whisper-1',
			provider: 'openai',
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
	 * Older records are not pruned from storage but are excluded from the
	 * returned array and from {@link getTotalCosts}.
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
				try {
					getVscode().window.showWarningMessage('Verba: Failed to reset cost records. Cost data may be stale.');
				} catch (vsErr: unknown) {
					if (!(vsErr instanceof Error && vsErr.message.includes('Cannot find module'))) {
						console.warn('[Verba] Failed to show reset-failure warning:', vsErr);
					}
				}
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
		Promise.resolve(this._globalState.update(STORAGE_KEY, this._allRecords()))
			.catch((err: unknown) => {
				console.error('[Verba] Failed to persist cost records:', err);
				if (!this._persistFailureWarned) {
					this._persistFailureWarned = true;
					try {
						getVscode().window.showWarningMessage('Verba: Failed to save cost records. Usage data for this session may be lost.');
					} catch (vsErr: unknown) {
						if (!(vsErr instanceof Error && vsErr.message.includes('Cannot find module'))) {
							console.warn('[Verba] Failed to show persist-failure warning:', vsErr);
						}
					}
				}
			});
	}
}
