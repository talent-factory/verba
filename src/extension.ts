import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerTextEditorCommand(
		'dictation.start',
		(editor, edit) => {
			const position = editor.selection.active;
			edit.insert(
				position,
				'[Verba] Dictation placeholder – speech recognition coming soon.'
			);
			vscode.window.showInformationMessage('Verba: Dictation started.');
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}
