/**
 * Tracks API usage costs for Whisper, Claude, and embedding models.
 * Persists cost records via VS Code globalState for cross-session totals.
 */

const STORAGE_KEY = 'verba.costRecords';

// Pricing as of 2026-02 — verify at https://openai.com/pricing and https://www.anthropic.com/pricing
// These rates must match the models used in cleanupService.ts and embeddingService.ts.
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

export class CostTracker {
	private readonly _globalState: GlobalState;
	private _previousRecords: UsageRecord[];
	private _sessionRecords: UsageRecord[] = [];

	constructor(globalState: GlobalState) {
		this._globalState = globalState;
		this._previousRecords = globalState.get<UsageRecord[]>(STORAGE_KEY, []);
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

	getTotalRecords(): UsageRecord[] {
		return [...this._previousRecords, ...this._sessionRecords];
	}

	resetTotalCosts(): void {
		this._previousRecords = [];
		this._sessionRecords = [];
		Promise.resolve(this._globalState.update(STORAGE_KEY, []))
			.catch((err: unknown) => { console.error('[Verba] Failed to reset cost records:', err); });
	}

	private _persist(): void {
		Promise.resolve(this._globalState.update(STORAGE_KEY, this.getTotalRecords()))
			.catch((err: unknown) => { console.error('[Verba] Failed to persist cost records:', err); });
	}
}
