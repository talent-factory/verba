/**
 * Tracks the last dictation insertion and provides undo functionality.
 *
 * Editor insertions are undone via reverse edits; terminal insertions
 * (when not yet executed) are undone via backspace characters.
 * Each new dictation replaces the previous undo record (single-level undo).
 */

interface InsertedRange {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
}

export interface DictationRecord {
	readonly type: 'editor' | 'terminal';
	readonly insertedText: string;
	/** Document URI (editor records only). */
	readonly documentUri?: string;
	/** Post-edit ranges where the inserted text now lives in the document (editor records only). */
	readonly insertedRanges?: InsertedRange[];
	/** Original text at each range before insertion (editor records only). */
	readonly originalTexts?: string[];
	/** Whether the text was executed (sent with Enter) in the terminal. */
	readonly wasExecuted?: boolean;
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
	const firstLineLength = text.indexOf('\n') === -1 ? text.length : text.indexOf('\n');

	let cumulativeLineDelta = 0;
	let cumulativeCharDelta = 0;
	let lastAffectedLine = -1;

	const ranges: InsertedRange[] = [];

	for (const sel of selections) {
		// Determine the insertion start point
		const origStartLine = sel.startLine;
		const origStartChar = sel.startCharacter;

		// Apply cumulative offset
		let adjustedStartLine = origStartLine + cumulativeLineDelta;
		let adjustedStartChar = origStartChar;
		if (origStartLine === lastAffectedLine) {
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
