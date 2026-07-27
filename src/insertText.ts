interface Selection {
	readonly active: unknown;
	readonly start: unknown;
	readonly end: unknown;
	readonly isEmpty: boolean;
}

interface TextEditor {
	selection: Selection;
	readonly selections: readonly Selection[];
	edit(callback: (editBuilder: {
		insert(position: unknown, value: string): void;
		replace(location: unknown, value: string): void;
	}) => void): Thenable<boolean>;
}

interface Terminal {
	sendText(text: string, addNewline?: boolean): void;
}

/** Indicates where the text was inserted. */
export interface InsertionResult {
	readonly target: 'editor' | 'terminal';
}

/**
 * Bracketed-paste markers. A TUI that enables bracketed paste (e.g. Claude Code,
 * Codex, or a readline shell) treats everything between them as a single paste —
 * so a multi-line block is inserted verbatim instead of typed line-by-line, where
 * the first embedded `\n` would fire Enter and submit only the first line (exactly
 * the "## Ziel sent on its own" bug with structured agent prompts). Only applied to
 * multi-line text: single-line sends are unchanged, keeping plain-shell behaviour
 * and the existing contract intact.
 */
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

/** Sends `text` to the terminal, wrapping multi-line content in bracketed paste so
 *  embedded newlines don't submit line-by-line. `executeCommand` adds the single
 *  trailing Enter (outside the paste markers) that submits the whole block. */
function sendToTerminal(terminal: Terminal, text: string, executeCommand: boolean): void {
	const multiline = text.includes('\n');
	console.log(`[Verba] Sending text to terminal (executeCommand=${executeCommand}, length=${text.length}, multiline=${multiline})`);
	const payload = multiline ? `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}` : text;
	terminal.sendText(payload, executeCommand);
}

/**
 * Inserts transcribed text into the active editor or terminal.
 *
 * Priority: if {@link preferTerminal} is true and a terminal exists, sends text there;
 * otherwise inserts at the editor cursor position; falls back to terminal if no editor is open.
 *
 * Selection-aware behaviour:
 * - If a cursor has a non-empty selection, the text **replaces** that selection.
 * - If a cursor has no selection, the text is **inserted** at the cursor position.
 * - Edits are applied in reverse document order to keep offsets stable.
 *
 * @param executeCommand - When inserting into a terminal, also submit with Enter.
 * @param preferTerminal - If true, prefer terminal over editor (used for terminal-initiated dictation).
 * @returns Which target received the text (`editor` or `terminal`).
 * @throws {Error} If no editor or terminal is available, or if the editor edit operation fails.
 */
export async function insertText(
	text: string,
	editor: TextEditor | undefined,
	terminal: Terminal | undefined,
	executeCommand: boolean,
	preferTerminal: boolean = false,
): Promise<InsertionResult> {
	if (preferTerminal && terminal) {
		sendToTerminal(terminal, text, executeCommand);
		return { target: 'terminal' };
	}

	if (editor) {
		const selections = editor.selections;
		const hasSelection = selections.some(s => !s.isEmpty);
		console.log(
			`[Verba] Inserting into editor: ${selections.length} cursor(s), ` +
			`${selections.filter(s => !s.isEmpty).length} selection(s), ` +
			`mode=${hasSelection ? 'replace' : 'insert'}, length=${text.length}`
		);

		let success: boolean;
		try {
			success = await editor.edit((editBuilder) => {
				// Sort selections in reverse document order to preserve offsets
				const sorted = [...selections].sort((a, b) => {
					const startA = a.start as { line: number; character: number };
					const startB = b.start as { line: number; character: number };
					if (startA.line !== startB.line) { return startB.line - startA.line; }
					return startB.character - startA.character;
				});

				for (const sel of sorted) {
					if (!sel.isEmpty) {
						editBuilder.replace(sel as any, text);
					} else {
						editBuilder.insert(sel.active, text);
					}
				}
			});
		} catch (err: unknown) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Failed to insert transcription — the editor may have been closed or the document changed. (${detail})`
			);
		}
		if (!success) {
			throw new Error(
				'Failed to insert transcription — the editor may have been closed or the document changed.'
			);
		}
		return { target: 'editor' };
	}

	if (terminal) {
		sendToTerminal(terminal, text, executeCommand);
		return { target: 'terminal' };
	}

	throw new Error('No active editor or terminal. Open a file or terminal before dictating.');
}
