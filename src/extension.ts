import * as vscode from 'vscode';
import * as fs from 'fs';
import { FfmpegRecorder } from './recorder';
import { StatusBarManager } from './statusBarManager';
import { DictationPipeline, PipelineContext } from './pipeline';
import { TranscriptionService } from './transcriptionService';
import { CleanupService } from './cleanupService';
import { insertText } from './insertText';
import { selectTemplate, Template } from './templatePicker';

class VerbaTranscriptionService extends TranscriptionService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return vscode.window.showInputBox({
			prompt: 'Enter your OpenAI API key for Whisper transcription',
			placeHolder: 'sk-...',
			password: true,
			ignoreFocusOut: true,
		});
	}
}

class VerbaCleanupService extends CleanupService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return vscode.window.showInputBox({
			prompt: 'Enter your Anthropic API key for text cleanup',
			placeHolder: 'sk-ant-...',
			password: true,
			ignoreFocusOut: true,
		});
	}
}

function cleanupFile(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch (err: unknown) {
		if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
			console.error('[Verba] Failed to clean up temp file:', err);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	const recorder = new FfmpegRecorder();
	const statusBar = new StatusBarManager();
	const pipeline = new DictationPipeline();
	let selectedTemplate: Template | undefined;

	pipeline.addStage(new VerbaTranscriptionService(context.secrets));
	pipeline.addStage(new VerbaCleanupService(context.secrets));

	recorder.onUnexpectedStop = (error) => {
		statusBar.setIdle();
		console.error('[Verba] Unexpected recording stop:', error);
		vscode.window.showErrorMessage(`Verba: ${error.message}`);
	};

	const disposable = vscode.commands.registerCommand(
		'dictation.start',
		async () => {
			if (recorder.isRecording) {
				let filePath: string | undefined;
				try {
					filePath = await recorder.stop();
					statusBar.setTranscribing();

					const pipelineContext: PipelineContext | undefined = selectedTemplate
						? { templatePrompt: selectedTemplate.prompt }
						: undefined;
					const transcript = await pipeline.run(filePath, pipelineContext);
					const executeCommand = vscode.workspace.getConfiguration('verba.terminal').get<boolean>('executeCommand', false);
					await insertText(
						transcript,
						vscode.window.activeTextEditor,
						vscode.window.activeTerminal,
						executeCommand,
					);

					statusBar.setIdle();
					vscode.window.setStatusBarMessage(
						'$(check) Verba: transcription inserted', 5000
					);
				} catch (err: unknown) {
					statusBar.setIdle();
					console.error('[Verba] Transcription failed:', err);
					const message = err instanceof Error ? err.message : String(err);
					vscode.window.showErrorMessage(`Verba: ${message}`);
				} finally {
					if (filePath) {
						cleanupFile(filePath);
					}
				}
			} else {
				try {
					const templates = vscode.workspace
						.getConfiguration('verba')
						.get<Template[]>('templates', []);
					const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');

					const template = await selectTemplate(
						templates,
						lastUsedName,
						(items, options) => vscode.window.showQuickPick(items, options) as any,
					);
					if (!template) {
						return;
					}
					selectedTemplate = template;
					await context.workspaceState.update('verba.lastTemplateName', template.name);

					await recorder.start();
					statusBar.setRecording();
					vscode.window.showInformationMessage(
						`Verba: Recording started (${template.name})...`
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
