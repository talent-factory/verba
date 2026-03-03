import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { FfmpegRecorder } from './recorder';
import { StatusBarManager } from './statusBarManager';
import { PipelineContext } from './pipeline';
import { TranscriptionService, TranscriptionProvider } from './transcriptionService';
import { CleanupService, Expansion } from './cleanupService';
import { insertText, InsertionResult } from './insertText';
import { recordDictation, clearLastDictation, computeInsertedRanges, executeUndo, UndoEditor, PreEditSelection } from './undoManager';
import { selectTemplate, findTemplateForLanguage, Template } from './templatePicker';
import { ContextProvider } from './contextProvider';
import { EmbeddingService } from './embeddingService';
import { Indexer } from './indexer';
import { GrepaiProvider } from './grepaiProvider';
import { CostTracker } from './costTracker';
import { CostOverviewPanel } from './costOverviewPanel';
import { HistoryManager } from './historyManager';
import { HistoryRecord } from './historyManager';
import { buildHistoryItems, buildActionItems, HistoryQuickPickItem, ActionQuickPickItem } from './historyCommands';
import { getWavDurationSec } from './wavDuration';
import { GlossaryGenerator } from './glossaryGenerator';
import { ContinuousRecorder, SegmentEvent } from './continuousRecorder';
import {
	WHISPER_MODELS, WHISPER_MODEL_BASE_URL,
	isTrustedDownloadHost, cleanupFile, isValidExpansion, isWhisperHallucination,
} from './extensionHelpers';

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


function wrapVscodeEditor(editor: vscode.TextEditor): UndoEditor {
	return {
		getTextInRange: (startLine, startChar, endLine, endChar) =>
			editor.document.getText(new vscode.Range(startLine, startChar, endLine, endChar)),
		applyEdits: (edits) =>
			editor.edit((editBuilder) => {
				for (const e of edits) {
					editBuilder.replace(new vscode.Range(e.startLine, e.startChar, e.endLine, e.endChar), e.newText);
				}
			}),
	};
}

/** Activates the Verba extension: registers commands, wires up services, and initializes the status bar. */
export function activate(context: vscode.ExtensionContext) {
	const recorder = new FfmpegRecorder();
	const statusBar = new StatusBarManager();
	const transcriptionService = new VerbaTranscriptionService(context.secrets);
	const cleanupService = new VerbaCleanupService(context.secrets);
	const costTracker = new CostTracker(context.globalState);
	const maxHistoryEntries = vscode.workspace.getConfiguration('verba').get<number>('history.maxEntries', 500);
	const historyManager = new HistoryManager(context.globalState, maxHistoryEntries);
	let selectedTemplate: Template | undefined;
	let preferTerminal = false;
	let processingAbortController: AbortController | null = null;
	let currentGlossary: string[] = [];

	// Continuous dictation state
	let continuousRecorder: ContinuousRecorder | null = null;
	let continuousSegmentQueue: Promise<void> = Promise.resolve();
	let continuousSegmentsInserted = 0;
	let continuousAbortController: AbortController | null = null;

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

	function loadExpansions(): Expansion[] {
		const rawGlobal = vscode.workspace
			.getConfiguration('verba')
			.get<unknown[]>('expansions', []);
		const rawGlobalArr = Array.isArray(rawGlobal) ? rawGlobal : [];
		const globalExpansions = rawGlobalArr.filter(isValidExpansion);
		const skippedGlobal = rawGlobalArr.length - globalExpansions.length;
		if (skippedGlobal > 0) {
			console.warn(`[Verba] Skipped ${skippedGlobal} invalid entries in verba.expansions setting`);
			vscode.window.showWarningMessage(
				`Verba: ${skippedGlobal} expansion(s) in settings were skipped (each entry must have non-empty "abbreviation" and "expansion" strings).`
			);
		}

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		let workspaceExpansions: Expansion[] = [];
		if (workspaceRoot) {
			const expansionsPath = path.join(workspaceRoot, '.verba-expansions.json');
			try {
				const content = fs.readFileSync(expansionsPath, 'utf-8');
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					workspaceExpansions = parsed.filter(isValidExpansion);
					const skippedWs = parsed.length - workspaceExpansions.length;
					if (skippedWs > 0) {
						console.warn(`[Verba] Skipped ${skippedWs} invalid entries in .verba-expansions.json`);
						vscode.window.showWarningMessage(
							`Verba: ${skippedWs} expansion(s) in .verba-expansions.json were skipped (each entry must have non-empty "abbreviation" and "expansion" strings).`
						);
					}
				} else {
					console.warn('[Verba] .verba-expansions.json is not an array, ignoring');
					vscode.window.showWarningMessage(
						'Verba: .verba-expansions.json must be a JSON array of {abbreviation, expansion} objects. Workspace expansions ignored.'
					);
				}
			} catch (err: unknown) {
				if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
					// File doesn't exist — normal state
				} else {
					const detail = err instanceof SyntaxError
						? 'Invalid JSON syntax'
						: (err instanceof Error ? err.message : String(err));
					console.warn('[Verba] Failed to read .verba-expansions.json:', err);
					vscode.window.showWarningMessage(
						`Verba: Could not load .verba-expansions.json (${detail}). Workspace expansions will not be applied.`
					);
				}
			}
		}

		// Merge: workspace expansions override global ones with the same abbreviation.
		// Abbreviations are lowercased for case-insensitive matching (the user may say "MFG", "mfg", or "Mfg").
		const merged = new Map<string, Expansion>();
		for (const e of [...globalExpansions, ...workspaceExpansions]) {
			const key = e.abbreviation.toLowerCase();
			merged.set(key, { abbreviation: key, expansion: e.expansion });
		}
		return [...merged.values()];
	}

	function applyExpansions(): void {
		const expansions = loadExpansions();
		cleanupService.setExpansions(expansions);
		if (expansions.length > 0) {
			console.log(`[Verba] Expansions loaded: ${expansions.length} entries`);
		}
	}
	applyExpansions();

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
		capturedSelectedText = undefined;
		statusBar.setIdle();
		console.error('[Verba] Unexpected recording stop:', error);
		vscode.window.showErrorMessage(`Verba: ${error.message}`);
	};

	// Text selected in the editor when recording started (captured early so it
	// survives editor focus changes during recording).
	let capturedSelectedText: string | undefined;

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

				// Track Whisper usage from WAV file duration (only for OpenAI API, not local whisper.cpp)
				const transcriptionProvider = vscode.workspace.getConfiguration('verba.transcription').get<string>('provider', 'openai');
				if (transcriptionProvider === 'openai') {
					const wavDurationSec = getWavDurationSec(filePath);
					if (wavDurationSec > 0) {
						costTracker.trackWhisperUsage(wavDurationSec);
					} else {
						console.warn('[Verba] WAV duration is 0 — Whisper cost tracking skipped for this recording');
					}
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
						vscode.window.showWarningMessage('Verba: Context search failed — proceeding without code context.');
					} finally {
						if (embeddingService.lastUsage) {
							costTracker.trackEmbeddingUsage(embeddingService.lastUsage.promptTokens);
							embeddingService.lastUsage = undefined;
						}
					}
				}

				// Step 3: Claude post-processing (pass captured selection as context only with a template)
				const pipelineContext: PipelineContext | undefined = selectedTemplate
					? { templatePrompt: selectedTemplate.prompt, contextSnippets, selectedText: capturedSelectedText }
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
						cleanupService.lastUsage = undefined; // Consume to prevent double-counting
					}
				} catch (err: unknown) {
					if (err instanceof Error && err.name === 'AbortError') {
						capturedSelectedText = undefined;
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

				// Capture pre-edit state for undo tracking
				const editorBeforeInsert = vscode.window.activeTextEditor;
				let preEditSelections: PreEditSelection[] | undefined;
				if (editorBeforeInsert && !preferTerminal) {
					preEditSelections = editorBeforeInsert.selections
						.map(sel => ({
							startLine: sel.start.line,
							startCharacter: sel.start.character,
							endLine: sel.end.line,
							endCharacter: sel.end.character,
							isEmpty: sel.isEmpty,
							originalText: sel.isEmpty ? '' : editorBeforeInsert.document.getText(sel),
						}))
						.sort((a, b) => a.startLine !== b.startLine
							? a.startLine - b.startLine
							: a.startCharacter - b.startCharacter);
				}

				const insertionResult = await insertText(
					transcript,
					vscode.window.activeTextEditor,
					vscode.window.activeTerminal,
					executeCommand,
					preferTerminal,
				);

				// Record dictation for undo
				if (insertionResult.target === 'editor' && editorBeforeInsert && preEditSelections) {
					const insertedRanges = computeInsertedRanges(preEditSelections, transcript);
					recordDictation({
						type: 'editor',
						documentUri: editorBeforeInsert.document.uri.toString(),
						insertedText: transcript,
						insertedRanges,
						originalTexts: preEditSelections.map(s => s.originalText),
					});
				} else if (insertionResult.target === 'terminal') {
					recordDictation({
						type: 'terminal',
						insertedText: transcript,
						wasExecuted: executeCommand,
					});
				} else {
					console.warn('[Verba] Editor insertion reported but pre-edit state unavailable — undo not recorded');
					clearLastDictation();
				}

				try {
					historyManager.addRecord({
						timestamp: Date.now(),
						rawTranscript,
						cleanedText: transcript,
						templateName: selectedTemplate?.name ?? 'Default Cleanup',
						target: insertionResult.target,
						languageId: vscode.window.activeTextEditor?.document.languageId,
						workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.name,
					});
				} catch (historyErr: unknown) {
					console.warn('[Verba] Failed to record dictation in history:', historyErr);
				}

				capturedSelectedText = undefined;
				statusBar.setIdle(selectedTemplate?.name);
				vscode.window.setStatusBarMessage(
					'$(check) Verba: transcription inserted', 5000
				);
			} catch (err: unknown) {
				capturedSelectedText = undefined;
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
			// Prevent starting if continuous recording is active
			if (continuousRecorder?.isRecording) {
				vscode.window.showWarningMessage('Verba: Continuous recording in progress. Stop it first.');
				return;
			}

			try {
				preferTerminal = forTerminal;
				const templates = loadTemplates();
				const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');

				let template: Template | undefined;

				// Auto-select template based on active file type (if enabled).
				// Auto-selected templates are transient — they do not update lastTemplateName,
				// so the user's manual template choice remains the stable fallback.
				const autoSelect = vscode.workspace.getConfiguration('verba').get<boolean>('autoSelectTemplate', true);
				if (autoSelect && !forTerminal) {
					const languageId = vscode.window.activeTextEditor?.document.languageId;
					if (languageId) {
						template = findTemplateForLanguage(templates, languageId);
						if (template) {
							console.log(`[Verba] Auto-selected template "${template.name}" for language "${languageId}"`);
						}
					}
				}

				// Fallback: last manually selected template
				if (!template && lastUsedName) {
					template = templates.find(t => t.name === lastUsedName);
				}

				// Final fallback: show picker
				if (!template) {
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

				// Capture selected text before recording starts (survives editor changes during recording)
				const activeEditor = vscode.window.activeTextEditor;
				if (activeEditor && !forTerminal) {
					const sel = activeEditor.selection;
					if (!sel.isEmpty) {
						capturedSelectedText = activeEditor.document.getText(sel);
					} else {
						capturedSelectedText = undefined;
					}
				} else {
					capturedSelectedText = undefined;
				}

				// Guard: template referencing <selection> requires actual selection
				if (!capturedSelectedText && selectedTemplate?.prompt.includes('<selection>')) {
					vscode.window.showWarningMessage(
						'Verba: This template requires text to be selected in the editor.'
					);
					return;
				}

				let audioDevice = vscode.workspace.getConfiguration('verba').get<string>('audioDevice', '').trim() || undefined;
				if (!audioDevice && process.platform === 'win32') {
					audioDevice = await pickAudioDevice(true);
					if (!audioDevice) {
						capturedSelectedText = undefined;
						return;
					}
				}
				await recorder.start(audioDevice);
				statusBar.setRecording();
				vscode.window.showInformationMessage(
					`Verba: Recording started (${template.name})...`
				);
			} catch (err: unknown) {
				capturedSelectedText = undefined;
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
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[Verba] Incremental indexing failed for ${relativePath}:`, err);
			if (err instanceof Error && ((err as any).status === 401 || (err as any).status === 429)) {
				vscode.window.showWarningMessage(`Verba: Index update failed — ${message}`);
			}
		}
	});

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot) {
		function watchWorkspaceFile(filename: string, callback: () => void): void {
			const pattern = new vscode.RelativePattern(workspaceRoot!, filename);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			const safeCallback = () => {
				try { callback(); } catch (err) {
					console.error(`[Verba] Failed to reload ${filename}:`, err);
					vscode.window.showWarningMessage(`Verba: Failed to reload ${filename}. Settings may be stale — try restarting VS Code.`);
				}
			};
			watcher.onDidChange(safeCallback);
			watcher.onDidCreate(safeCallback);
			watcher.onDidDelete(safeCallback);
			context.subscriptions.push(watcher);
		}

		watchWorkspaceFile('.verba-glossary.json', applyGlossary);
		watchWorkspaceFile('.verba-expansions.json', applyExpansions);
	}

	const settingsWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('verba.glossary')) {
			try { applyGlossary(); } catch (err) {
				console.error('[Verba] Failed to reload glossary from settings:', err);
				vscode.window.showWarningMessage('Verba: Failed to reload glossary from settings. Changes may not take effect until VS Code is restarted.');
			}
		}
		if (e.affectsConfiguration('verba.expansions')) {
			try { applyExpansions(); } catch (err) {
				console.error('[Verba] Failed to reload expansions from settings:', err);
				vscode.window.showWarningMessage('Verba: Failed to reload expansions from settings. Changes may not take effect until VS Code is restarted.');
			}
		}
		if (e.affectsConfiguration('verba.transcription')) {
			try { applyTranscriptionProvider(); } catch (err) {
				console.error('[Verba] Failed to reload transcription provider from settings:', err);
				vscode.window.showWarningMessage('Verba: Failed to reload transcription settings. Changes may not take effect until VS Code is restarted.');
			}
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

						if (!isTrustedDownloadHost(requestUrl)) {
							safeReject(new Error(`Download failed: redirect to untrusted host in URL "${requestUrl}"`));
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
		try {
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
		} catch (err: unknown) {
			console.error('[Verba] manageApiKeys failed:', err);
			const message = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Verba: Could not manage API keys: ${message}`);
		}
	});

	const editorCommand = vscode.commands.registerCommand('dictation.start', () => handleDictation(false));
	const terminalCommand = vscode.commands.registerCommand('dictation.startFromTerminal', () => handleDictation(true));

	const showCostOverviewCommand = vscode.commands.registerCommand('dictation.showCostOverview', () => {
		try {
			CostOverviewPanel.createOrShow(costTracker);
		} catch (err: unknown) {
			console.error('[Verba] Failed to open Cost Overview panel:', err);
			const message = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Verba: Could not open Cost Overview: ${message}`);
		}
	});

	const generateGlossaryCommand = vscode.commands.registerCommand('dictation.generateGlossary', async () => {
		try {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceRoot) {
				vscode.window.showWarningMessage('Verba: Open a workspace to generate glossary.');
				return;
			}

			const generator = new GlossaryGenerator();
			const suggestions = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Verba: Scanning project for glossary terms...' },
				() => generator.generate(workspaceRoot, currentGlossary),
			);

			if (suggestions.length === 0) {
				vscode.window.showInformationMessage('Verba: No new glossary terms found in this project.');
				return;
			}

			const items = suggestions.map(term => ({ label: term, picked: true }));
			const selected = await vscode.window.showQuickPick(items, {
				canPickMany: true,
				placeHolder: `${suggestions.length} terms found — deselect any you don't want`,
				title: 'Verba: Review Glossary Suggestions',
			});

			if (!selected || selected.length === 0) {
				return;
			}

			const selectedTerms = selected.map(s => s.label);

			// Load existing glossary file
			const glossaryPath = path.join(workspaceRoot, '.verba-glossary.json');
			let existing: string[] = [];
			try {
				const content = fs.readFileSync(glossaryPath, 'utf-8');
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					existing = parsed.filter((t): t is string => typeof t === 'string');
				}
			} catch (readErr: unknown) {
				if (readErr instanceof Error && (readErr as NodeJS.ErrnoException).code === 'ENOENT') {
					// File doesn't exist yet -- will be created
				} else {
					const detail = readErr instanceof SyntaxError
						? 'Invalid JSON syntax'
						: (readErr instanceof Error ? readErr.message : String(readErr));
					console.warn('[Verba] Failed to read existing .verba-glossary.json:', readErr);
					const action = await vscode.window.showWarningMessage(
						`Verba: Could not read existing glossary (${detail}). Continuing will create a new file with only the selected terms.`,
						'Continue', 'Cancel',
					);
					if (action !== 'Continue') { return; }
				}
			}

			// Merge, deduplicate, sort
			const merged = [...new Set([...existing, ...selectedTerms])].sort((a, b) => a.localeCompare(b));
			try {
				fs.writeFileSync(glossaryPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
			} catch (writeErr: unknown) {
				const detail = writeErr instanceof Error ? writeErr.message : String(writeErr);
				console.error('[Verba] Failed to write glossary file:', writeErr);
				vscode.window.showErrorMessage(`Verba: Could not save glossary to .verba-glossary.json: ${detail}`);
				return;
			}

			const added = merged.length - existing.length;
			vscode.window.showInformationMessage(`Verba: ${added} term${added !== 1 ? 's' : ''} added to glossary (${merged.length} total).`);

			// Reload glossary so Whisper + Claude pick it up immediately
			try {
				applyGlossary();
			} catch (reloadErr: unknown) {
				console.warn('[Verba] Glossary saved but reload failed:', reloadErr);
				vscode.window.showWarningMessage('Verba: Glossary file saved, but live reload failed. Restart VS Code to apply the new terms.');
			}
		} catch (err: unknown) {
			console.error('[Verba] generateGlossary failed:', err);
			const message = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Verba: Could not generate glossary: ${message}`);
		}
	});

	const undoCommand = vscode.commands.registerCommand('dictation.undo', async () => {
		const result = await executeUndo({
			getActiveTerminal: () => vscode.window.activeTerminal ?? undefined,
			findEditorForUri: (uri) => {
				const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri);
				return ed ? wrapVscodeEditor(ed) : undefined;
			},
			openDocument: async (uri) => {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
				return wrapVscodeEditor(await vscode.window.showTextDocument(doc));
			},
		});

		switch (result.status) {
			case 'no-record':
				vscode.window.showInformationMessage('Verba: No dictation to undo.');
				break;
			case 'terminal-was-executed':
				vscode.window.showInformationMessage('Verba: Cannot undo — text was already executed in terminal.');
				break;
			case 'terminal-no-terminal':
				vscode.window.showWarningMessage('Verba: No active terminal to undo in. Undo record discarded.');
				break;
			case 'terminal-undone':
				vscode.window.setStatusBarMessage('$(discard) Verba: sent undo to terminal (verify result)', 5000);
				break;
			case 'editor-document-unavailable':
				vscode.window.showErrorMessage('Verba: Cannot undo — the original document could not be opened. It may have been moved, renamed, or deleted.');
				break;
			case 'editor-document-changed':
				vscode.window.showWarningMessage('Verba: The document has changed since the last dictation. Undo aborted.');
				break;
			case 'editor-undone':
				vscode.window.setStatusBarMessage('$(discard) Verba: dictation undone', 5000);
				break;
			case 'editor-edit-failed':
				vscode.window.showErrorMessage('Verba: Failed to undo dictation — the edit was rejected.');
				break;
			case 'error':
				vscode.window.showErrorMessage(`Verba: Could not undo dictation: ${result.message}`);
				break;
		}
	});

	// --- History Commands ---

	async function handleHistoryAction(record: HistoryRecord): Promise<void> {
		const actionItems = buildActionItems();
		const action = await vscode.window.showQuickPick<ActionQuickPickItem>(actionItems, {
			placeHolder: 'Choose an action',
		});
		if (!action) { return; }

		try {
			switch (action.id) {
				case 'insert': {
					const editor = vscode.window.activeTextEditor;
					const terminal = vscode.window.activeTerminal;
					if (editor) {
						const success = await editor.edit((editBuilder) => {
							for (const sel of editor.selections) {
								editBuilder.replace(sel, record.cleanedText);
							}
						});
						if (!success) {
							vscode.window.showWarningMessage('Verba: Could not insert text. The editor may be read-only or was closed.');
						}
					} else if (terminal) {
						terminal.sendText(record.cleanedText, false);
					} else {
						vscode.window.showWarningMessage('Verba: No active editor or terminal to insert into.');
					}
					break;
				}
				case 'copy':
					await vscode.env.clipboard.writeText(record.cleanedText);
					vscode.window.showInformationMessage('Verba: Copied to clipboard.');
					break;
				case 'details':
					vscode.window.showInformationMessage(
						[
							`Template: ${record.templateName}`,
							`Time: ${new Date(record.timestamp).toLocaleString()}`,
							`Target: ${record.target}`,
							`Raw transcript: ${record.rawTranscript}`,
						].join('\n'),
						{ modal: true },
					);
					break;
			}
		} catch (err: unknown) {
			console.error('[Verba] History action failed:', err);
			const message = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Verba: History action failed: ${message}`);
		}
	}

	const showHistoryCommand = vscode.commands.registerCommand('dictation.showHistory', async () => {
		const records = historyManager.getRecords();
		if (records.length === 0) {
			vscode.window.showInformationMessage('Verba: No dictation history yet.');
			return;
		}

		const items = buildHistoryItems(records);
		const picked = await vscode.window.showQuickPick<HistoryQuickPickItem>(items, {
			placeHolder: `${records.length} dictations \u2014 type to filter`,
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!picked) { return; }

		await handleHistoryAction(picked.record);
	});

	const searchHistoryCommand = vscode.commands.registerCommand('dictation.searchHistory', async () => {
		const query = await vscode.window.showInputBox({
			placeHolder: 'Search dictation history...',
		});
		if (!query) { return; }

		const results = historyManager.searchRecords(query);
		if (results.length === 0) {
			vscode.window.showInformationMessage('Verba: No matching history entries found.');
			return;
		}

		const items = buildHistoryItems(results);
		const picked = await vscode.window.showQuickPick<HistoryQuickPickItem>(items, {
			placeHolder: `${results.length} result${results.length !== 1 ? 's' : ''} \u2014 type to filter`,
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!picked) { return; }

		await handleHistoryAction(picked.record);
	});

	const clearHistoryCommand = vscode.commands.registerCommand('dictation.clearHistory', async () => {
		const count = historyManager.getRecordCount();
		if (count === 0) {
			vscode.window.showInformationMessage('Verba: History is already empty.');
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Verba: Delete all ${count} history entries?`,
			{ modal: true },
			'Delete All',
		);
		if (confirm === 'Delete All') {
			historyManager.clearHistory();
			vscode.window.showInformationMessage('Verba: Dictation history cleared.');
		}
	});

	// --- Continuous Dictation Command ---

	const startContinuousCommand = vscode.commands.registerCommand('dictation.startContinuous', async () => {
		// Cancel ongoing segment processing if user triggers shortcut during streaming
		if (continuousAbortController) {
			continuousAbortController.abort();
			continuousAbortController = null;
			// Fall through to stop recording (don't return)
		}

		// Stop continuous recording if already active
		if (continuousRecorder?.isRecording) {
			try {
				console.log(`[Verba] Stopping continuous recording (${continuousSegmentsInserted} segments so far)`);
				const mainWavPath = await continuousRecorder.stop();
				console.log('[Verba] Recorder stopped, waiting for segment queue to drain...');
				// Wait for all pending segment processing
				await continuousSegmentQueue;
				console.log(`[Verba] All segments processed (${continuousSegmentsInserted} total)`);
				statusBar.setIdle(selectedTemplate?.name);
				vscode.window.setStatusBarMessage(
					`$(check) Verba: ${continuousSegmentsInserted} segment${continuousSegmentsInserted !== 1 ? 's' : ''} inserted`, 5000
				);
				// Cleanup
				if (mainWavPath) { cleanupFile(mainWavPath); }
				continuousRecorder.dispose();
				continuousRecorder = null;
			} catch (err: unknown) {
				statusBar.setIdle();
				const message = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Verba: ${message}`);
				if (continuousRecorder) {
					continuousRecorder.dispose();
					continuousRecorder = null;
				}
			}
			return;
		}

		// Prevent starting if single-shot is recording
		if (recorder.isRecording) {
			vscode.window.showWarningMessage('Verba: Single-shot recording in progress. Stop it first.');
			return;
		}

		// Template selection (same logic as handleDictation's else branch)
		try {
			const templates = loadTemplates();
			const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');
			let template: Template | undefined;

			const autoSelect = vscode.workspace.getConfiguration('verba').get<boolean>('autoSelectTemplate', true);
			if (autoSelect) {
				const languageId = vscode.window.activeTextEditor?.document.languageId;
				if (languageId) {
					template = findTemplateForLanguage(templates, languageId);
					if (template) {
						console.log(`[Verba] Continuous: Auto-selected template "${template.name}" for language "${languageId}"`);
					}
				}
			}
			if (!template && lastUsedName) {
				template = templates.find(t => t.name === lastUsedName);
			}
			if (!template) {
				template = await selectTemplate(
					templates,
					undefined,
					(items, options) => vscode.window.showQuickPick(items, options) as any,
				);
				if (!template) { return; }
				await context.workspaceState.update('verba.lastTemplateName', template.name);
			}

			// Capture template locally — don't mutate shared selectedTemplate
			const continuousTemplate = template;

			// Capture selected text (once at recording start, shared across all segments)
			const activeEditor = vscode.window.activeTextEditor;
			let capturedText: string | undefined;
			if (activeEditor) {
				const sel = activeEditor.selection;
				if (!sel.isEmpty) {
					capturedText = activeEditor.document.getText(sel);
				}
			}

			// Guard: template referencing <selection> requires actual selection
			if (!capturedText && continuousTemplate.prompt.includes('<selection>')) {
				vscode.window.showWarningMessage(
					'Verba: This template requires text to be selected in the editor.'
				);
				return;
			}

			// Read continuous dictation settings
			const silenceThreshold = vscode.workspace.getConfiguration('verba.continuous').get<number>('silenceThreshold', 1.5);
			const silenceLevel = vscode.workspace.getConfiguration('verba.continuous').get<number>('silenceLevel', -30);

			// Create recorder
			continuousRecorder = new ContinuousRecorder(undefined, silenceThreshold, silenceLevel);
			continuousSegmentsInserted = 0;
			continuousSegmentQueue = Promise.resolve();
			let lastSegmentTranscript = '';

			// Continuous dictation targets the editor
			const executeCommand = vscode.workspace.getConfiguration('verba.terminal').get<boolean>('executeCommand', false);
			const preferTerminalForContinuous = false;

			// Listen for segments
			continuousRecorder.on('segment', (event: SegmentEvent) => {
				continuousSegmentQueue = continuousSegmentQueue.then(async () => {
					try {
						statusBar.setRecordingContinuous(continuousSegmentsInserted, true);

						// Transcribe — pass previous segment's transcript as Whisper prompt
						// context. This dramatically reduces hallucinations at segment
						// boundaries because Whisper knows what was said before.
						const whisperContext = lastSegmentTranscript
							? [...(currentGlossary || []), lastSegmentTranscript]
							: currentGlossary;
						const rawTranscript = await transcriptionService.process(event.segmentPath, whisperContext);

						// Guard: skip Whisper hallucinations on short/silent segments.
						// Whisper produces characteristic garbage text when given very
						// short audio (e.g. "Microsoft Office Word Document",
						// "MBC 뉴스", "Amara.org", repeated punctuation). These
						// patterns never appear in genuine dictation.
						if (isWhisperHallucination(rawTranscript)) {
							console.log(`[Verba] Skipping hallucinated segment: "${rawTranscript.substring(0, 60)}"`);
							return;
						}

						// Track Whisper cost
						const provider = vscode.workspace.getConfiguration('verba.transcription').get<string>('provider', 'openai');
						if (provider === 'openai') {
							const wavDurationSec = getWavDurationSec(event.segmentPath);
							if (wavDurationSec > 0) { costTracker.trackWhisperUsage(wavDurationSec); }
						}

						// Claude cleanup
						const pipelineContext = continuousTemplate
							? { templatePrompt: continuousTemplate.prompt, selectedText: capturedText }
							: undefined;
						const abortController = new AbortController();
						continuousAbortController = abortController;

						let transcript: string;
						try {
							transcript = await cleanupService.processStreaming(
								rawTranscript,
								pipelineContext,
								(_charCount) => statusBar.setRecordingContinuous(continuousSegmentsInserted, true),
								abortController.signal,
							);
							if (cleanupService.lastUsage) {
								costTracker.trackClaudeUsage(
									cleanupService.lastUsage.inputTokens,
									cleanupService.lastUsage.outputTokens,
								);
								cleanupService.lastUsage = undefined;
							}
						} catch (err: unknown) {
							if (err instanceof Error && (
								err.name === 'AbortError'
								|| err.message.includes('aborted')
								|| err.message.includes('cancelled')
								|| err.message.includes('canceled')
							)) {
								return; // Cancelled by user
							}
							const message = err instanceof Error ? err.message : String(err);
							console.error('[Verba] Claude cleanup failed for segment:', err);

							if (message.includes('401') || message.includes('authentication') || message.includes('403')) {
								vscode.window.showErrorMessage(
									'Verba: Claude API key invalid or expired. Raw transcript inserted. Fix via "Verba: Manage API Keys".'
								);
							} else {
								vscode.window.showWarningMessage(
									`Verba: Post-processing failed for segment. Raw transcript inserted. (${message})`
								);
							}
							transcript = rawTranscript;
						} finally {
							continuousAbortController = null;
						}

						// Prepend separator between segments (space or newline)
						const separator = continuousSegmentsInserted > 0 ? '\n' : '';
						const textToInsert = separator + transcript;

						// Insert text
						const insertionResult = await insertText(
							textToInsert,
							vscode.window.activeTextEditor,
							vscode.window.activeTerminal,
							executeCommand,
							preferTerminalForContinuous,
						);

						// Record undo (per segment)
						if (insertionResult.target === 'editor') {
							recordDictation({
								type: 'editor',
								documentUri: vscode.window.activeTextEditor?.document.uri.toString() ?? '',
								insertedText: textToInsert,
								insertedRanges: [],
								originalTexts: [],
							});
						}

						// Record history (per segment)
						try {
							historyManager.addRecord({
								timestamp: Date.now(),
								rawTranscript,
								cleanedText: transcript,
								templateName: continuousTemplate.name ?? 'Default Cleanup',
								target: insertionResult.target,
								languageId: vscode.window.activeTextEditor?.document.languageId,
								workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.name,
							});
						} catch (historyErr: unknown) {
							console.warn('[Verba] Failed to record segment in history:', historyErr);
						}

						lastSegmentTranscript = transcript;
						continuousSegmentsInserted++;
						statusBar.setRecordingContinuous(continuousSegmentsInserted);
					} catch (err: unknown) {
						console.error('[Verba] Segment processing failed:', err);
						const message = err instanceof Error ? err.message : String(err);
						vscode.window.showWarningMessage(`Verba: Segment failed: ${message}`);
						statusBar.setRecordingContinuous(continuousSegmentsInserted);
					} finally {
						cleanupFile(event.segmentPath);
					}
				});
			});

			let lastRecorderErrorTime = 0;
			continuousRecorder.on('error', (err: Error) => {
				console.error('[Verba] Continuous recorder error:', err);
				const now = Date.now();
				if (now - lastRecorderErrorTime > 10_000) {
					lastRecorderErrorTime = now;
					vscode.window.showWarningMessage(`Verba: Recording issue: ${err.message}`);
				}
			});

			// Start recording
			const preferredDevice = vscode.workspace.getConfiguration('verba').get<string>('audioDevice', '').trim() || undefined;
			await continuousRecorder.start(preferredDevice);
			statusBar.setRecordingContinuous();
			selectedTemplate = continuousTemplate;
			vscode.window.showInformationMessage(
				`Verba: Continuous recording started (${continuousTemplate.name})...`
			);
		} catch (err: unknown) {
			continuousRecorder = null;
			statusBar.setIdle(selectedTemplate?.name);
			console.error('[Verba] Start continuous recording failed:', err);
			const message = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Verba: ${message}`);
		}
	});

	context.subscriptions.push(
		editorCommand, terminalCommand, selectDeviceCommand, selectTemplateCommand,
		indexProjectCommand, downloadModelCommand, manageApiKeysCommand, showCostOverviewCommand,
		generateGlossaryCommand, undoCommand, showHistoryCommand, searchHistoryCommand, clearHistoryCommand,
		startContinuousCommand,
		saveWatcher,
		{ dispose: () => { recorder.dispose(); if (continuousRecorder) { continuousRecorder.dispose(); } } }, statusBar,
	);
}

/** Called by VS Code when the extension is deactivated. Cleanup is handled via `context.subscriptions`. */
export function deactivate() {}
