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
	let preferTerminal = false;

	pipeline.addStage(new VerbaTranscriptionService(context.secrets));
	pipeline.addStage(new VerbaCleanupService(context.secrets));

	recorder.onUnexpectedStop = (error) => {
		selectedTemplate = undefined;
		statusBar.setIdle();
		console.error('[Verba] Unexpected recording stop:', error);
		vscode.window.showErrorMessage(`Verba: ${error.message}`);
	};

	const handleDictation = async (forTerminal: boolean) => {
		if (recorder.isRecording) {
			let filePath: string | undefined;
			try {
				filePath = await recorder.stop();
				statusBar.setTranscribing();

				const pipelineContext: PipelineContext | undefined = selectedTemplate
					? { templatePrompt: selectedTemplate.prompt }
					: undefined;

				const fileStats = fs.statSync(filePath);
				console.log(`[Verba] WAV file: ${filePath} (${fileStats.size} bytes)`);

				const transcript = await pipeline.run(filePath, pipelineContext);
				console.log(`[Verba] Final text (${transcript.length} chars): ${transcript.substring(0, 200)}`);

				const executeCommand = vscode.workspace.getConfiguration('verba.terminal').get<boolean>('executeCommand', false);
				await insertText(
					transcript,
					vscode.window.activeTextEditor,
					vscode.window.activeTerminal,
					executeCommand,
					preferTerminal,
				);

				statusBar.setIdle();
				vscode.window.setStatusBarMessage(
					'$(check) Verba: transcription inserted', 5000
				);
			} catch (err: unknown) {
				selectedTemplate = undefined;
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
				preferTerminal = forTerminal;
				const rawTemplates = vscode.workspace
					.getConfiguration('verba')
					.get<Template[]>('templates', []);
				const templates = rawTemplates.filter(
					(t): t is Template =>
						typeof t?.name === 'string' && t.name.trim() !== ''
						&& typeof t?.prompt === 'string' && t.prompt.trim() !== '',
				);
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

				let audioDevice = vscode.workspace.getConfiguration('verba').get<string>('audioDevice', '').trim() || undefined;
				if (!audioDevice && process.platform === 'win32') {
					audioDevice = await pickAudioDevice(true);
					if (!audioDevice) {
						return;
					}
				}
				await recorder.start(audioDevice);
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
						const url = process.platform === 'win32'
							? 'https://ffmpeg.org/download.html'
							: process.platform === 'linux'
								? 'https://ffmpeg.org/download.html#build-linux'
								: 'https://formulae.brew.sh/formula/ffmpeg';
						vscode.env.openExternal(vscode.Uri.parse(url));
					}
				} else {
					vscode.window.showErrorMessage(`Verba: ${message}`);
				}
			}
		}
	};

	async function pickAudioDevice(firstRun: boolean): Promise<string | undefined> {
		const devices = recorder.listAudioDevices();
		if (devices.length === 0) {
			vscode.window.showWarningMessage('Verba: No audio devices found. Is ffmpeg installed?');
			return undefined;
		}

		const currentDevice = vscode.workspace.getConfiguration('verba').get<string>('audioDevice', '');
		const items = devices.map(name => ({
			label: name,
			description: name === currentDevice ? '(current)' : undefined,
		}));

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: firstRun
				? 'Which microphone should Verba use for dictation?'
				: 'Select microphone for dictation',
			title: 'Verba: Audio Device',
		});
		if (!picked) {
			return undefined;
		}

		if (firstRun) {
			await vscode.workspace.getConfiguration('verba').update(
				'audioDevice', picked.label, vscode.ConfigurationTarget.Global,
			);
		} else {
			const target = await vscode.window.showQuickPick(
				[
					{ label: 'User Settings', description: 'Applies globally', target: vscode.ConfigurationTarget.Global },
					{ label: 'Workspace Settings', description: 'Applies to this project only', target: vscode.ConfigurationTarget.Workspace },
				],
				{ placeHolder: 'Where should this setting be saved?' },
			);
			if (!target) {
				return undefined;
			}
			await vscode.workspace.getConfiguration('verba').update(
				'audioDevice', picked.label, target.target,
			);
		}

		vscode.window.showInformationMessage(`Verba: Audio device set to "${picked.label}"`);
		return picked.label;
	}

	const selectDeviceCommand = vscode.commands.registerCommand('dictation.selectAudioDevice', () => pickAudioDevice(false));

	const editorCommand = vscode.commands.registerCommand('dictation.start', () => handleDictation(false));
	const terminalCommand = vscode.commands.registerCommand('dictation.startFromTerminal', () => handleDictation(true));

	context.subscriptions.push(editorCommand, terminalCommand, selectDeviceCommand, { dispose: () => recorder.dispose() }, statusBar);
}

export function deactivate() {}
