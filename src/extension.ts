import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FfmpegRecorder } from './recorder';
import { StatusBarManager } from './statusBarManager';
import { DictationPipeline, PipelineContext } from './pipeline';
import { TranscriptionService } from './transcriptionService';
import { CleanupService } from './cleanupService';
import { insertText } from './insertText';
import { selectTemplate, Template } from './templatePicker';
import { ContextProvider } from './contextProvider';
import { EmbeddingService } from './embeddingService';
import { Indexer } from './indexer';
import { GrepaiProvider } from './grepaiProvider';

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
	const transcriptionService = new VerbaTranscriptionService(context.secrets);
	const cleanupService = new VerbaCleanupService(context.secrets);
	const pipeline = new DictationPipeline();
	let selectedTemplate: Template | undefined;
	let preferTerminal = false;
	let processingAbortController: AbortController | null = null;

	const embeddingService = new EmbeddingService(context.secrets);

	function setupContextProvider(): ContextProvider {
		const config = vscode.workspace.getConfiguration('verba.contextSearch');
		const providerSetting = config.get<string>('provider', 'auto');
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

		if (!workspaceRoot) {
			return new ContextProvider({ type: 'none' });
		}

		const useGrepai = providerSetting === 'grepai'
			|| (providerSetting === 'auto' && GrepaiProvider.isAvailable(workspaceRoot));

		if (useGrepai) {
			console.log('[Verba] Using grepai for context search');
			return new ContextProvider({ type: 'grepai', grepai: new GrepaiProvider(workspaceRoot) });
		}

		const indexDir = path.join(workspaceRoot, '.verba');
		const indexer = new Indexer(workspaceRoot, indexDir, embeddingService);
		console.log('[Verba] Using OpenAI Embeddings for context search');
		return new ContextProvider({ type: 'openai', embeddingService, indexer });
	}

	let contextProvider = setupContextProvider();

	function loadTemplates(): Template[] {
		const rawTemplates = vscode.workspace
			.getConfiguration('verba')
			.get<Template[]>('templates', []);
		return rawTemplates.filter(
			(t): t is Template =>
				typeof t?.name === 'string' && t.name.trim() !== ''
				&& typeof t?.prompt === 'string' && t.prompt.trim() !== '',
		);
	}

	// Show active template in status bar on startup
	const initialTemplateName = context.workspaceState.get<string>('verba.lastTemplateName');
	if (initialTemplateName) {
		statusBar.setIdle(initialTemplateName);
	}

	pipeline.addStage(transcriptionService);
	pipeline.addStage(cleanupService);

	recorder.onUnexpectedStop = (error) => {
		selectedTemplate = undefined;
		statusBar.setIdle();
		console.error('[Verba] Unexpected recording stop:', error);
		vscode.window.showErrorMessage(`Verba: ${error.message}`);
	};

	const handleDictation = async (forTerminal: boolean) => {
		// Cancel ongoing processing if user triggers shortcut during streaming
		if (processingAbortController) {
			processingAbortController.abort();
			processingAbortController = null;
			return;
		}

		if (recorder.isRecording) {
			let filePath: string | undefined;
			try {
				filePath = await recorder.stop();
				statusBar.setTranscribing();

				const fileStats = fs.statSync(filePath);
				console.log(`[Verba] WAV file: ${filePath} (${fileStats.size} bytes)`);

				// Step 1: Transcribe via Whisper
				const rawTranscript = await transcriptionService.process(filePath);
				console.log(`[Verba] Whisper transcript (${rawTranscript.length} chars): ${rawTranscript.substring(0, 200)}`);

				// Step 2: Context retrieval (only for context-aware templates)
				let contextSnippets: string[] | undefined;
				if (selectedTemplate?.contextAware && contextProvider.isAvailable()) {
					const maxResults = vscode.workspace.getConfiguration('verba.contextSearch').get<number>('maxResults', 5);
					try {
						contextSnippets = await contextProvider.search(rawTranscript, maxResults);
						console.log(`[Verba] Retrieved ${contextSnippets.length} context snippets`);
					} catch (err: unknown) {
						console.warn('[Verba] Context search failed, proceeding without context:', err);
					}
				}

				// Step 3: Claude post-processing
				const pipelineContext: PipelineContext | undefined = selectedTemplate
					? { templatePrompt: selectedTemplate.prompt, contextSnippets }
					: undefined;
				statusBar.setProcessing();
				const abortController = new AbortController();
				processingAbortController = abortController;

				let transcript: string;
				try {
					transcript = await cleanupService.processStreaming(
						rawTranscript,
						pipelineContext,
						(charCount) => statusBar.setProcessing(charCount),
						abortController.signal,
					);
				} catch (err: unknown) {
					if (err instanceof Error && err.name === 'AbortError') {
						statusBar.setIdle(selectedTemplate?.name);
						vscode.window.showInformationMessage('Verba: Dictation cancelled.');
						return;
					}
					throw err;
				} finally {
					processingAbortController = null;
				}
				console.log(`[Verba] Final text (${transcript.length} chars): ${transcript.substring(0, 200)}`);

				const executeCommand = vscode.workspace.getConfiguration('verba.terminal').get<boolean>('executeCommand', false);
				await insertText(
					transcript,
					vscode.window.activeTextEditor,
					vscode.window.activeTerminal,
					executeCommand,
					preferTerminal,
				);

				statusBar.setIdle(selectedTemplate?.name);
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
				const templates = loadTemplates();
				const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');
				const lastUsedTemplate = lastUsedName
					? templates.find(t => t.name === lastUsedName)
					: undefined;

				let template: Template | undefined;
				if (lastUsedTemplate) {
					template = lastUsedTemplate;
				} else {
					template = await selectTemplate(
						templates,
						undefined,
						(items, options) => vscode.window.showQuickPick(items, options) as any,
					);
					if (!template) {
						return;
					}
					await context.workspaceState.update('verba.lastTemplateName', template.name);
				}
				selectedTemplate = template;

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
				statusBar.setIdle(selectedTemplate?.name);
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

	// Index Project command
	const indexProjectCommand = vscode.commands.registerCommand('dictation.indexProject', async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showWarningMessage('Verba: Open a workspace to index.');
			return;
		}

		contextProvider = setupContextProvider();

		if (contextProvider.providerType === 'grepai') {
			vscode.window.showInformationMessage('Verba: grepai is active — use "grepai init && grepai watch" to manage the index.');
			return;
		}

		const indexDir = path.join(workspaceRoot, '.verba');
		const indexer = new Indexer(workspaceRoot, indexDir, embeddingService);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Verba: Indexing project...',
			cancellable: false,
		}, async (progress) => {
			const files = await vscode.workspace.findFiles(
				'**/*.{ts,js,py,java,go,rs,cpp,c,h,cs,rb,php,swift,kt,scala,md}',
				'{**/node_modules/**,**/dist/**,**/out/**,**/.git/**,**/.verba/**}',
			);
			const relativePaths = files.map(f => vscode.workspace.asRelativePath(f));

			const totalChunks = await indexer.indexAll(relativePaths, (done, total) => {
				progress.report({ increment: (1 / total) * 100, message: `${done}/${total} files` });
			});

			vscode.window.showInformationMessage(`Verba: Indexed ${relativePaths.length} files (${totalChunks} chunks).`);
		});
	});

	// Incremental indexing on file save
	const saveWatcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
		if (!contextProvider.isAvailable() || contextProvider.providerType === 'grepai') {
			return;
		}

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) { return; }

		const relativePath = vscode.workspace.asRelativePath(doc.uri);
		if (relativePath.startsWith('.verba/') || relativePath.includes('node_modules')) { return; }

		try {
			const indexDir = path.join(workspaceRoot, '.verba');
			const indexer = new Indexer(workspaceRoot, indexDir, embeddingService);
			const count = await indexer.indexFile(relativePath);
			if (count > 0) {
				indexer.save();
				console.log(`[Verba] Re-indexed ${relativePath} (${count} chunks)`);
			}
		} catch (err: unknown) {
			console.warn(`[Verba] Incremental indexing failed for ${relativePath}:`, err);
		}
	});

	const selectDeviceCommand = vscode.commands.registerCommand('dictation.selectAudioDevice', () => pickAudioDevice(false));

	const selectTemplateCommand = vscode.commands.registerCommand('dictation.selectTemplate', async () => {
		const templates = loadTemplates();
		const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');
		const template = await selectTemplate(
			templates,
			lastUsedName,
			(items, options) => vscode.window.showQuickPick(items, options) as any,
		);
		if (!template) {
			return;
		}
		await context.workspaceState.update('verba.lastTemplateName', template.name);
		selectedTemplate = template;
		statusBar.setIdle(template.name);
		vscode.window.showInformationMessage(`Verba: Template set to "${template.name}"`);
	});

	const editorCommand = vscode.commands.registerCommand('dictation.start', () => handleDictation(false));
	const terminalCommand = vscode.commands.registerCommand('dictation.startFromTerminal', () => handleDictation(true));

	context.subscriptions.push(
		editorCommand, terminalCommand, selectDeviceCommand, selectTemplateCommand,
		indexProjectCommand, saveWatcher,
		{ dispose: () => recorder.dispose() }, statusBar,
	);
}

export function deactivate() {}
