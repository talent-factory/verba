/**
 * Tracks the last dictation insertion and provides undo functionality.
 *
 * Editor insertions are undone via reverse edits; terminal insertions
 * (when not yet executed) are undone via backspace characters.
 * Each new dictation replaces the previous undo record (single-level undo).
 */

export interface InsertedRange {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
}

export interface PreEditSelection {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
	readonly isEmpty: boolean;
	readonly originalText: string;
}

interface EditorDictationRecord {
	readonly type: 'editor';
	readonly insertedText: string;
	readonly documentUri: string;
	readonly insertedRanges: InsertedRange[];
	readonly originalTexts: string[];
}

interface TerminalDictationRecord {
	readonly type: 'terminal';
	readonly insertedText: string;
	readonly wasExecuted: boolean;
}

export type DictationRecord = EditorDictationRecord | TerminalDictationRecord;

/** Result of an undo operation, used for user feedback. */
export type UndoResult =
	| { status: 'no-record' }
	| { status: 'terminal-was-executed' }
	| { status: 'terminal-no-terminal' }
	| { status: 'terminal-undone' }
	| { status: 'editor-document-unavailable'; reason: string }
	| { status: 'editor-document-changed' }
	| { status: 'editor-undone' }
	| { status: 'editor-edit-failed' }
	| { status: 'error'; message: string };

/** Dependencies injected by the caller (VS Code API or test mocks). */
export interface UndoDeps {
	getActiveTerminal(): { sendText(text: string, addNewline: boolean): void } | undefined;
	findEditorForUri(uri: string): UndoEditor | undefined;
	openDocument(uri: string): Promise<UndoEditor>;
}

export interface UndoEditor {
	getTextInRange(startLine: number, startChar: number, endLine: number, endChar: number): string;
	applyEdits(edits: Array<{ startLine: number; startChar: number; endLine: number; endChar: number; newText: string }>): PromiseLike<boolean>;
}

/**
 * Executes the undo operation for the last dictation.
 * Returns a result indicating what happened (caller handles user feedback).
 */
export async function executeUndo(deps: UndoDeps): Promise<UndoResult> {
	const record = getLastDictation();
	if (!record) {
		return { status: 'no-record' };
	}

	try {
		if (record.type === 'terminal') {
			if (record.wasExecuted) {
				clearLastDictation();
				return { status: 'terminal-was-executed' };
			}
			const terminal = deps.getActiveTerminal();
			if (!terminal) {
				clearLastDictation();
				return { status: 'terminal-no-terminal' };
			}
			// Limitation: cannot verify terminal state — user may have edited the input line.
			terminal.sendText('\x7F'.repeat(record.insertedText.length), false);
			clearLastDictation();
			return { status: 'terminal-undone' };
		}

		// Editor undo
		let editor = deps.findEditorForUri(record.documentUri);
		if (!editor) {
			try {
				editor = await deps.openDocument(record.documentUri);
			} catch (openErr) {
				console.error('[Verba] Failed to open document for undo:', openErr);
				clearLastDictation();
				const reason = openErr instanceof Error ? openErr.message : String(openErr);
				return { status: 'editor-document-unavailable', reason };
			}
		}

		// Verify the inserted text is still at the expected ranges
		for (const r of record.insertedRanges) {
			const currentText = editor.getTextInRange(r.startLine, r.startCharacter, r.endLine, r.endCharacter);
			if (currentText !== record.insertedText) {
				clearLastDictation();
				return { status: 'editor-document-changed' };
			}
		}

		// Build reverse edits in reverse document order to keep offsets stable
		const sortedIndices = record.insertedRanges
			.map((_, i) => i)
			.sort((a, b) => {
				const ra = record.insertedRanges[a];
				const rb = record.insertedRanges[b];
				if (ra.startLine !== rb.startLine) { return rb.startLine - ra.startLine; }
				return rb.startCharacter - ra.startCharacter;
			});

		const edits = sortedIndices.map(i => ({
			startLine: record.insertedRanges[i].startLine,
			startChar: record.insertedRanges[i].startCharacter,
			endLine: record.insertedRanges[i].endLine,
			endChar: record.insertedRanges[i].endCharacter,
			newText: record.originalTexts[i],
		}));

		const success = await editor.applyEdits(edits);
		if (success) {
			clearLastDictation();
			return { status: 'editor-undone' };
		}
		// Transient failure: keep undo record so user can retry
		return { status: 'editor-edit-failed' };
	} catch (err: unknown) {
		console.error('[Verba] Undo dictation failed:', err);
		// Keep undo record on unexpected errors so user can retry
		const message = err instanceof Error ? err.message : String(err);
		return { status: 'error', message };
	}
}

let lastDictation: DictationRecord | undefined;

export function recordDictation(record: DictationRecord): void {
	lastDictation = record;
}

export function clearLastDictation(): void {
	lastDictation = undefined;
}

export function getLastDictation(): DictationRecord | undefined {
	return lastDictation;
}

/**
 * Computes the end position after inserting {@link text} at the given start position.
 */
export function computeEndPosition(
	startLine: number,
	startCharacter: number,
	text: string,
): { line: number; character: number } {
	const lines = text.split('\n');
	if (lines.length === 1) {
		return { line: startLine, character: startCharacter + text.length };
	}
	return {
		line: startLine + lines.length - 1,
		character: lines[lines.length - 1].length,
	};
}

/**
 * Computes the post-edit ranges for a multi-cursor dictation insertion.
 *
 * Selections must be provided in **forward document order** (ascending by position).
 * Each selection is adjusted by the cumulative offset from preceding insertions.
 */
export function computeInsertedRanges(
	selections: ReadonlyArray<{
		readonly startLine: number;
		readonly startCharacter: number;
		readonly endLine: number;
		readonly endCharacter: number;
		readonly isEmpty: boolean;
	}>,
	text: string,
): InsertedRange[] {
	const textEnd = computeEndPosition(0, 0, text);
	const textLineCount = textEnd.line; // number of newlines in the text

	let cumulativeLineDelta = 0;
	let cumulativeCharDelta = 0;
	let lastAffectedLine = -1;

	const ranges: InsertedRange[] = [];

	for (const sel of selections) {
		// Apply cumulative offset
		let adjustedStartLine = sel.startLine + cumulativeLineDelta;
		let adjustedStartChar = sel.startCharacter;
		if (sel.startLine === lastAffectedLine) {
			adjustedStartChar += cumulativeCharDelta;
		}

		// Compute end of inserted text
		const end = computeEndPosition(adjustedStartLine, adjustedStartChar, text);

		ranges.push({
			startLine: adjustedStartLine,
			startCharacter: adjustedStartChar,
			endLine: end.line,
			endCharacter: end.character,
		});

		// Update cumulative offset for next selections
		// The offset is: lines added by this insert minus lines removed (if selection was non-empty)
		const selectionLineSpan = sel.endLine - sel.startLine;
		const linesAdded = textLineCount - selectionLineSpan;
		cumulativeLineDelta += linesAdded;

		// Character offset: only affects cursors on the same ending line
		if (textLineCount === 0 && selectionLineSpan === 0) {
			// Single-line insert replacing single-line selection (or cursor insert)
			const selectionCharSpan = sel.isEmpty ? 0 : (sel.endCharacter - sel.startCharacter);
			cumulativeCharDelta += text.length - selectionCharSpan;
			lastAffectedLine = sel.startLine;
		} else {
			// Multi-line changes reset character tracking
			cumulativeCharDelta = 0;
			lastAffectedLine = -1;
		}
	}

	return ranges;
}
