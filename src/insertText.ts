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
): Promise<void> {
	if (editor) {
		const success = await editor.edit((editBuilder) => {
			editBuilder.insert(editor.selection.active, text);
		});
		if (!success) {
			throw new Error(
				'Failed to insert transcription — the editor may have been closed or the document changed.'
			);
		}
		return;
	}

	if (terminal) {
		terminal.sendText(text, executeCommand);
		return;
	}

	throw new Error('No active editor or terminal. Open a file or terminal before dictating.');
}
