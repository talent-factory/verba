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

/**
 * Inserts transcribed text into the active editor or terminal.
 *
 * Priority: if {@link preferTerminal} is true and a terminal exists, sends text there;
 * otherwise inserts at the editor cursor position; falls back to terminal if no editor is open.
 *
 * Selection-aware behaviour:
 * - If any selection is non-empty, the text **replaces** every selection.
 * - If multiple cursors exist without a selection, the text is **inserted** at each cursor position.
 * - Edits are applied in reverse document order to keep offsets stable.
 *
 * @param executeCommand - When inserting into a terminal, also submit with Enter.
 * @param preferTerminal - If true, prefer terminal over editor (used for terminal-initiated dictation).
 */
export async function insertText(
	text: string,
	editor: TextEditor | undefined,
	terminal: Terminal | undefined,
	executeCommand: boolean,
	preferTerminal: boolean = false,
): Promise<void> {
	if (preferTerminal && terminal) {
		console.log(`[Verba] Sending text to terminal (executeCommand=${executeCommand}, length=${text.length})`);
		terminal.sendText(text, executeCommand);
		return;
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
					if (hasSelection) {
						// Replace each selection (sel is a vscode.Selection which extends Range)
						editBuilder.replace(sel as any, text);
					} else {
						// Insert at each cursor position (multi-cursor without selection)
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
		return;
	}

	if (terminal) {
		console.log(`[Verba] Sending text to terminal (executeCommand=${executeCommand}, length=${text.length})`);
		terminal.sendText(text, executeCommand);
		return;
	}

	throw new Error('No active editor or terminal. Open a file or terminal before dictating.');
}
