interface TextEditor {
	selection: { active: unknown };
	edit(callback: (editBuilder: { insert(position: unknown, value: string): void }) => void): Thenable<boolean>;
}

interface Terminal {
	sendText(text: string, addNewline?: boolean): void;
}

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
		let success: boolean;
		try {
			success = await editor.edit((editBuilder) => {
				editBuilder.insert(editor.selection.active, text);
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
