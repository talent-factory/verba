/**
 * Manages dictation history records with full-text search.
 * Persists records via VS Code globalState for cross-session access.
 */

const STORAGE_KEY = 'verba.history';
const DEFAULT_MAX_ENTRIES = 500;

/**
 * Formats a timestamp into a human-readable relative time string.
 * - <60s ago → "just now"
 * - <60min ago → "N min ago"
 * - Today → "HH:MM"
 * - Yesterday → "Yesterday HH:MM"
 * - Older → "YYYY-MM-DD"
 */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);

	if (diffSec < 60) {
		return 'just now';
	}

	if (diffMin < 60) {
		return `${diffMin} min ago`;
	}

	const date = new Date(timestamp);
	const today = new Date(now);
	const hh = String(date.getHours()).padStart(2, '0');
	const mm = String(date.getMinutes()).padStart(2, '0');

	// Check if same calendar day
	if (
		date.getFullYear() === today.getFullYear()
		&& date.getMonth() === today.getMonth()
		&& date.getDate() === today.getDate()
	) {
		return `${hh}:${mm}`;
	}

	// Check if yesterday
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (
		date.getFullYear() === yesterday.getFullYear()
		&& date.getMonth() === yesterday.getMonth()
		&& date.getDate() === yesterday.getDate()
	) {
		return `Yesterday ${hh}:${mm}`;
	}

	// Older
	const yyyy = String(date.getFullYear());
	const mon = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	return `${yyyy}-${mon}-${dd}`;
}

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
