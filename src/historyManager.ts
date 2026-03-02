/**
 * Manages dictation history records with full-text search.
 * Persists records via VS Code globalState for cross-session access.
 */

const STORAGE_KEY = 'verba.history';
const DEFAULT_MAX_ENTRIES = 500;

export interface HistoryRecord {
	id: string;
	timestamp: number;
	rawTranscript: string;
	cleanedText: string;
	templateName: string;
	target: 'editor' | 'terminal';
	languageId?: string;
	workspaceFolder?: string;
}

export interface GlobalState {
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: unknown): Thenable<void>;
}

// Lazy-load vscode module so HistoryManager remains testable outside the extension host.
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getVscode(): typeof import('vscode') { return require('vscode'); }

let _globalIdCounter = 0;

export class HistoryManager {
	private readonly _globalState: GlobalState;
	private readonly _maxEntries: number;
	private _records: HistoryRecord[];
	private _persistFailureWarned = false;

	constructor(globalState: GlobalState, maxEntries: number = DEFAULT_MAX_ENTRIES) {
		this._globalState = globalState;
		this._maxEntries = Math.max(1, maxEntries);
		const raw = globalState.get<unknown[]>(STORAGE_KEY, []);
		this._records = (Array.isArray(raw) ? raw : []).filter(
			(r): r is HistoryRecord =>
				typeof (r as any)?.id === 'string'
				&& typeof (r as any)?.timestamp === 'number'
				&& typeof (r as any)?.rawTranscript === 'string'
				&& typeof (r as any)?.cleanedText === 'string'
				&& typeof (r as any)?.templateName === 'string'
				&& ((r as any)?.target === 'editor' || (r as any)?.target === 'terminal'),
		);
	}

	addRecord(input: Omit<HistoryRecord, 'id'>): void {
		const id = `${Date.now()}-${_globalIdCounter++}`;
		const record: HistoryRecord = { id, ...input };
		this._records.push(record);

		// FIFO pruning: remove oldest entries when exceeding maxEntries
		while (this._records.length > this._maxEntries) {
			this._records.shift();
		}

		this._persist();
	}

	getRecords(): HistoryRecord[] {
		return [...this._records].reverse();
	}

	searchRecords(query: string): HistoryRecord[] {
		const lowerQuery = query.toLowerCase();
		return this.getRecords().filter(
			r => r.rawTranscript.toLowerCase().includes(lowerQuery)
				|| r.cleanedText.toLowerCase().includes(lowerQuery),
		);
	}

	clearHistory(): void {
		this._records = [];
		this._persist();
	}

	getRecordCount(): number {
		return this._records.length;
	}

	private _persist(): void {
		const snapshot = [...this._records];
		Promise.resolve(this._globalState.update(STORAGE_KEY, snapshot))
			.then(() => {
				this._persistFailureWarned = false;
			})
			.catch((err: unknown) => {
				console.error('[Verba] Failed to persist history records:', err);
				if (!this._persistFailureWarned) {
					this._persistFailureWarned = true;
					try {
						getVscode().window.showWarningMessage('Verba: Failed to save dictation history. History data for this session may be lost.');
					} catch (vsErr: unknown) {
						if (!(vsErr instanceof Error && vsErr.message.includes('Cannot find module'))) {
							console.warn('[Verba] Failed to show persist-failure warning:', vsErr);
						}
					}
				}
			});
	}
}
