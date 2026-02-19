import * as vscode from 'vscode';
import { FfmpegRecorder } from './recorder';
import { StatusBarManager } from './statusBarManager';

export function activate(context: vscode.ExtensionContext) {
	const recorder = new FfmpegRecorder();
	const statusBar = new StatusBarManager();

	recorder.onUnexpectedStop = (error) => {
		statusBar.setIdle();
		console.error('[Verba] Unexpected recording stop:', error);
		vscode.window.showErrorMessage(`Verba: ${error.message}`);
	};

	const disposable = vscode.commands.registerCommand(
		'dictation.start',
		async () => {
			if (recorder.isRecording) {
				try {
					const filePath = await recorder.stop();
					statusBar.setIdle();
					vscode.window.showInformationMessage(
						`Verba: Recording saved to ${filePath}`
					);
				} catch (err: unknown) {
					statusBar.setIdle();
					console.error('[Verba] Stop recording failed:', err);
					const message = err instanceof Error ? err.message : String(err);
					vscode.window.showErrorMessage(`Verba: ${message}`);
				}
			} else {
				try {
					await recorder.start();
					statusBar.setRecording();
					vscode.window.showInformationMessage(
						'Verba: Recording started...'
					);
				} catch (err: unknown) {
					statusBar.setIdle();
					console.error('[Verba] Start recording failed:', err);
					const message = err instanceof Error ? err.message : String(err);

					if (message.includes('ffmpeg not found')) {
						const action = await vscode.window.showErrorMessage(
							`Verba: ${message}`,
							'Install Instructions'
						);
						if (action === 'Install Instructions') {
							vscode.env.openExternal(
								vscode.Uri.parse('https://formulae.brew.sh/formula/ffmpeg')
							);
						}
					} else {
						vscode.window.showErrorMessage(`Verba: ${message}`);
					}
				}
			}
		}
	);

	context.subscriptions.push(disposable, { dispose: () => recorder.dispose() }, statusBar);
}

export function deactivate() {}
