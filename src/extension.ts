import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { FfmpegRecorder } from './recorder';
import { StatusBarManager } from './statusBarManager';
import { PipelineContext } from './pipeline';
import { TranscriptionService, TranscriptionProvider } from './transcriptionService';
import { CleanupService } from './cleanupService';
import { insertText } from './insertText';
import { selectTemplate, Template } from './templatePicker';
import { ContextProvider } from './contextProvider';
import { EmbeddingService } from './embeddingService';
import { Indexer } from './indexer';
import { GrepaiProvider } from './grepaiProvider';
import { CostTracker } from './costTracker';
import { CostOverviewPanel } from './costOverviewPanel';

const WHISPER_MODELS: { name: string; file: string; size: string }[] = [
	{ name: 'tiny', file: 'ggml-tiny.bin', size: '~75 MB' },
	{ name: 'base', file: 'ggml-base.bin', size: '~148 MB' },
	{ name: 'small', file: 'ggml-small.bin', size: '~488 MB' },
	{ name: 'medium', file: 'ggml-medium.bin', size: '~1.5 GB' },
	{ name: 'large-v3-turbo', file: 'ggml-large-v3-turbo.bin', size: '~1.6 GB' },
];

const WHISPER_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

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

/** Calculates the duration of a WAV file in seconds by reading its header. */
function getWavDurationSec(wavPath: string): number {
	try {
		const fd = fs.openSync(wavPath, 'r');
		const header = Buffer.alloc(44);
		fs.readSync(fd, header, 0, 44, 0);
		fs.closeSync(fd);
		const byteRate = header.readUInt32LE(28);
		const dataSize = header.readUInt32LE(40);
		if (byteRate === 0) { return 0; }
		return dataSize / byteRate;
	} catch {
		return 0;
	}
}

/** Activates the Verba extension: registers commands, wires up services, and initializes the status bar. */
export function activate(context: vscode.ExtensionContext) {
	const recorder = new FfmpegRecorder();
	const statusBar = new StatusBarManager();
	const transcriptionService = new VerbaTranscriptionService(context.secrets);
	const cleanupService = new VerbaCleanupService(context.secrets);
	const costTracker = new CostTracker(context.globalState);
	let selectedTemplate: Template | undefined;
	let preferTerminal = false;
	let processingAbortController: AbortController | null = null;
	let currentGlossary: string[] = [];

	function applyTranscriptionProvider(): void {
		const config = vscode.workspace.getConfiguration('verba.transcription');
		const provider = config.get<string>('provider', 'openai');
		const modelName = config.get<string>('localModel', 'base');

		if (provider !== 'openai' && provider !== 'local') {
			vscode.window.showErrorMessage(
				`Verba: Unknown transcription provider "${provider}". Valid values: "openai", "local". Falling back to OpenAI.`
			);
			transcriptionService.setProvider('openai');
			statusBar.setProvider('openai');
			return;
		}

		if (provider === 'local') {
			const modelInfo = WHISPER_MODELS.find(m => m.name === modelName);
			if (!modelInfo) {
				const validNames = WHISPER_MODELS.map(m => m.name).join(', ');
				vscode.window.showErrorMessage(
					`Verba: Unknown model "${modelName}". Valid models: ${validNames}. Falling back to OpenAI provider.`
				);
				transcriptionService.setProvider('openai');
				return;
			}
			transcriptionService.setProvider(provider);
			statusBar.setProvider(provider);
			const modelsDir = path.join(context.globalStorageUri.fsPath, 'models');
			const modelPath = path.join(modelsDir, modelInfo.file);
			transcriptionService.setModelPath(modelPath);
			console.log(`[Verba] Transcription provider: local (model: ${modelName})`);
		} else {
			transcriptionService.setProvider(provider);
			statusBar.setProvider(provider);
			console.log('[Verba] Transcription provider: openai');
		}
	}
	applyTranscriptionProvider();

	function applyGlossary(): void {
		currentGlossary = loadGlossary();
		cleanupService.setGlossary(currentGlossary);
		if (currentGlossary.length > 0) {
			console.log(`[Verba] Glossary loaded: ${currentGlossary.length} terms`);
		}
		if (currentGlossary.length > 80) {
			vscode.window.showWarningMessage(
				`Verba: Glossary has ${currentGlossary.length} terms (recommended limit: ~80). Excess terms may be ignored by Whisper.`
			);
		}
	}
	applyGlossary();

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

	function loadGlossary(): string[] {
		const rawGlobalTerms = vscode.workspace
			.getConfiguration('verba')
			.get<unknown[]>('glossary', []);
		const globalTerms = (Array.isArray(rawGlobalTerms) ? rawGlobalTerms : [])
			.filter((t): t is string => typeof t === 'string' && t.trim() !== '');

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		let workspaceTerms: string[] = [];
		if (workspaceRoot) {
			const glossaryPath = path.join(workspaceRoot, '.verba-glossary.json');
			try {
				const content = fs.readFileSync(glossaryPath, 'utf-8');
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					workspaceTerms = parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
				} else {
					console.warn('[Verba] .verba-glossary.json is not an array, ignoring');
					vscode.window.showWarningMessage(
						'Verba: .verba-glossary.json must be a JSON array of strings (e.g. ["term1", "term2"]). Workspace glossary ignored.'
					);
				}
			} catch (err: unknown) {
				if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
					// File doesn't exist — normal state, no workspace glossary
				} else {
					const detail = err instanceof SyntaxError
						? 'Invalid JSON syntax'
						: (err instanceof Error ? err.message : String(err));
					console.warn('[Verba] Failed to read .verba-glossary.json:', err);
					vscode.window.showWarningMessage(
						`Verba: Could not load .verba-glossary.json (${detail}). Workspace glossary terms will not be applied.`
					);
				}
			}
		}

		// Merge workspace and global terms, deduplicating. Workspace terms listed first
		// so they are retained by Set deduplication when duplicates exist.
		return [...new Set([...workspaceTerms, ...globalTerms])];
	}

	// Show active template in status bar on startup
	const initialTemplateName = context.workspaceState.get<string>('verba.lastTemplateName');
	if (initialTemplateName) {
		statusBar.setIdle(initialTemplateName);
	}

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

				// Step 1: Transcribe via Whisper (uses cached glossary from applyGlossary)
				const rawTranscript = await transcriptionService.process(filePath, currentGlossary);
				console.log(`[Verba] Whisper transcript (${rawTranscript.length} chars): ${rawTranscript.substring(0, 200)}`);

				// Track Whisper usage from WAV file duration
				const wavDurationSec = getWavDurationSec(filePath);
				if (wavDurationSec > 0) {
					costTracker.trackWhisperUsage(wavDurationSec);
				}

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
					if (cleanupService.lastUsage) {
						costTracker.trackClaudeUsage(
							cleanupService.lastUsage.inputTokens,
							cleanupService.lastUsage.outputTokens,
						);
					}
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

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot) {
		const glossaryPattern = new vscode.RelativePattern(workspaceRoot, '.verba-glossary.json');
		const glossaryWatcher = vscode.workspace.createFileSystemWatcher(glossaryPattern);
		const safeApplyGlossary = () => {
			try { applyGlossary(); } catch (err) {
				console.error('[Verba] Failed to reload glossary:', err);
			}
		};
		glossaryWatcher.onDidChange(safeApplyGlossary);
		glossaryWatcher.onDidCreate(safeApplyGlossary);
		glossaryWatcher.onDidDelete(safeApplyGlossary);
		context.subscriptions.push(glossaryWatcher);
	}

	const settingsWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('verba.glossary')) {
			applyGlossary();
		}
		if (e.affectsConfiguration('verba.transcription')) {
			applyTranscriptionProvider();
			statusBar.setIdle(selectedTemplate?.name);
		}
	});
	context.subscriptions.push(settingsWatcher);

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

	const downloadModelCommand = vscode.commands.registerCommand('dictation.downloadModel', async () => {
		const items = WHISPER_MODELS.map(m => ({
			label: m.name,
			description: m.size,
			detail: m.name === 'base' ? 'Recommended — good balance of speed and accuracy' : undefined,
			model: m,
		}));

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select Whisper model to download',
			title: 'Verba: Download Whisper Model',
		});
		if (!picked) {
			return;
		}

		try {
			const modelsDir = path.join(context.globalStorageUri.fsPath, 'models');
			fs.mkdirSync(modelsDir, { recursive: true });

			const destPath = path.join(modelsDir, picked.model.file);
			if (fs.existsSync(destPath)) {
				const overwrite = await vscode.window.showWarningMessage(
					`Model "${picked.model.name}" already exists. Download again?`,
					'Yes', 'No',
				);
				if (overwrite !== 'Yes') {
					return;
				}
			}

			const url = `${WHISPER_MODEL_BASE_URL}/${picked.model.file}?download=true`;
			const MAX_REDIRECTS = 5;

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Verba: Downloading ${picked.model.name} model (${picked.model.size})...`,
				cancellable: true,
			}, (progress, token) => {
				return new Promise<void>((resolve, reject) => {
					const fileStream = fs.createWriteStream(destPath);
					let aborted = false;
					let settled = false;
					let activeRequest: ReturnType<typeof https.get> | null = null;

					const cleanupPartialFile = () => {
						try {
							fs.unlinkSync(destPath);
						} catch (cleanupErr: unknown) {
							if (cleanupErr instanceof Error && (cleanupErr as NodeJS.ErrnoException).code !== 'ENOENT') {
								console.warn('[Verba] Failed to remove partial download:', cleanupErr);
							}
						}
					};

					const cleanup = () => {
						if (activeRequest) {
							activeRequest.destroy();
							activeRequest = null;
						}
						fileStream.destroy();
						cleanupPartialFile();
					};

					const safeReject = (err: Error) => {
						if (settled) { return; }
						settled = true;
						cleanup();
						reject(err);
					};

					const safeResolve = () => {
						if (settled) { return; }
						settled = true;
						resolve();
					};

					token.onCancellationRequested(() => {
						aborted = true;
						const cancelError = new Error('Download cancelled');
						cancelError.name = 'CancelError';
						safeReject(cancelError);
					});

					const doRequest = (requestUrl: string, redirectCount: number) => {
						if (redirectCount > MAX_REDIRECTS) {
							safeReject(new Error('Download failed: too many redirects'));
							return;
						}

						if (!requestUrl.startsWith('https://')) {
							safeReject(new Error('Download failed: only HTTPS URLs are allowed'));
							return;
						}

						activeRequest = https.get(requestUrl, (res) => {
							if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
								res.resume();
								doRequest(res.headers.location, redirectCount + 1);
								return;
							}

							if (res.statusCode !== 200) {
								res.resume();
								safeReject(new Error(`Download failed: HTTP ${res.statusCode}`));
								return;
							}

							const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
							let downloadedBytes = 0;
							let lastReportedPercent = 0;

							res.on('data', (chunk: Buffer) => {
								if (aborted) { return; }
								downloadedBytes += chunk.length;
								if (totalBytes > 0) {
									const percent = Math.floor((downloadedBytes / totalBytes) * 100);
									if (percent > lastReportedPercent) {
										progress.report({ increment: percent - lastReportedPercent });
										lastReportedPercent = percent;
									}
								}
							});

							res.pipe(fileStream);

							fileStream.on('finish', () => {
								if (aborted) { return; }
								activeRequest = null;
								if (totalBytes > 0 && downloadedBytes !== totalBytes) {
									safeReject(new Error(
										`Download incomplete: received ${downloadedBytes} of ${totalBytes} bytes. Please try again.`
									));
									return;
								}
								// Sanity check: GGML models are always > 1 MB
								try {
									const stats = fs.statSync(destPath);
									if (stats.size < 1_000_000) {
										safeReject(new Error(
											`Downloaded file is suspiciously small (${stats.size} bytes). `
											+ 'The model may be corrupt. Please try downloading again.'
										));
										return;
									}
								} catch (statErr: unknown) {
									const detail = statErr instanceof Error ? statErr.message : String(statErr);
									safeReject(new Error(`Cannot verify downloaded model: ${detail}`));
									return;
								}
								vscode.window.showInformationMessage(
									`Verba: Model "${picked.model.name}" downloaded successfully.`
								);
								safeResolve();
							});

							fileStream.on('error', (err) => {
								if (aborted) { return; }
								safeReject(new Error(`Download failed: ${err.message}`));
							});
						}).on('error', (err) => {
							if (aborted) { return; }
							safeReject(new Error(`Download failed: ${err.message}`));
						});
					};

					doRequest(url, 0);
				});
			});
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'CancelError') {
				vscode.window.showInformationMessage('Verba: Model download cancelled.');
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			console.error('[Verba] Model download failed:', err);
			vscode.window.showErrorMessage(`Verba: ${message}`);
		}
	});

	const manageApiKeysCommand = vscode.commands.registerCommand('dictation.manageApiKeys', async () => {
		const keys = [
			{ label: 'OpenAI', storageKey: 'openai-api-key', prefix: 'sk-' },
			{ label: 'Anthropic', storageKey: 'anthropic-api-key', prefix: 'sk-ant-' },
		];

		const items = await Promise.all(keys.map(async (k) => {
			const stored = await context.secrets.get(k.storageKey);
			const status = stored
				? `${stored.slice(0, k.prefix.length + 2)}...${stored.slice(-4)}`
				: 'Not configured';
			return {
				label: `$(key) ${k.label} API Key`,
				description: status,
				detail: stored ? 'Configured' : 'No key stored',
				storageKey: k.storageKey,
				hasKey: !!stored,
				keyLabel: k.label,
				prefix: k.prefix,
			};
		}));

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select an API key to manage',
			title: 'Verba: Manage API Keys',
		});
		if (!picked) { return; }

		const actions = picked.hasKey
			? [
				{ label: '$(edit) Update Key', action: 'update' as const },
				{ label: '$(trash) Delete Key', action: 'delete' as const },
			]
			: [
				{ label: '$(add) Set Key', action: 'update' as const },
			];

		const action = await vscode.window.showQuickPick(actions, {
			placeHolder: `${picked.keyLabel} API Key`,
			title: 'Verba: Manage API Keys',
		});
		if (!action) { return; }

		if (action.action === 'delete') {
			await context.secrets.delete(picked.storageKey);
			vscode.window.showInformationMessage(`Verba: ${picked.keyLabel} API key deleted.`);
		} else {
			const newKey = await vscode.window.showInputBox({
				prompt: `Enter your ${picked.keyLabel} API key`,
				placeHolder: `${picked.prefix}...`,
				password: true,
				ignoreFocusOut: true,
			});
			if (!newKey) { return; }
			await context.secrets.store(picked.storageKey, newKey);
			vscode.window.showInformationMessage(`Verba: ${picked.keyLabel} API key updated.`);
		}
	});

	const editorCommand = vscode.commands.registerCommand('dictation.start', () => handleDictation(false));
	const terminalCommand = vscode.commands.registerCommand('dictation.startFromTerminal', () => handleDictation(true));

	const showCostOverviewCommand = vscode.commands.registerCommand('dictation.showCostOverview', () => {
		CostOverviewPanel.createOrShow(context.extensionUri, costTracker);
	});

	context.subscriptions.push(
		editorCommand, terminalCommand, selectDeviceCommand, selectTemplateCommand,
		indexProjectCommand, downloadModelCommand, manageApiKeysCommand, showCostOverviewCommand, saveWatcher,
		{ dispose: () => recorder.dispose() }, statusBar,
	);
}

/** Called by VS Code when the extension is deactivated. Cleanup is handled via `context.subscriptions`. */
export function deactivate() {}
