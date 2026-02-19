import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerTextEditorCommand(
		'dictation.start',
		(editor) => {
			const position = editor.selection.active;

			editor.edit((editBuilder) => {
				editBuilder.insert(
					position,
					'[Verba] Dictation placeholder – speech recognition coming soon.'
				);
			});

			vscode.window.showInformationMessage('Verba: Dictation started.');
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}
