import * as vscode from 'vscode';
import type { TranscriptionProvider } from './transcriptionService';

/** Manages the Verba status bar item, reflecting the current dictation state. */
export class StatusBarManager {
	private item: vscode.StatusBarItem;
	private _provider: TranscriptionProvider = 'openai';

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100
		);
		this.item.command = 'dictation.start';
		this.setIdle();
		this.item.show();
	}

	/** Updates the active transcription provider shown in tooltip and transcribing state. */
	setProvider(provider: TranscriptionProvider): void {
		this._provider = provider;
	}

	/** Shows the idle state, optionally displaying the active template name. */
	setIdle(templateName?: string): void {
		this.item.text = templateName
			? `$(mic) Verba: ${templateName}`
			: '$(mic) Verba';
		this.item.backgroundColor = undefined;
		const providerLabel = this._provider === 'local' ? 'Local (whisper.cpp)' : 'OpenAI Whisper';
		this.item.tooltip = templateName
			? `Provider: ${providerLabel} · Template: ${templateName} — Click to start dictation`
			: `Provider: ${providerLabel} — Click to start dictation`;
	}

	/** Shows the recording state with a red background. */
	setRecording(): void {
		this.item.text = '$(circle-filled) Recording...';
		this.item.backgroundColor = new vscode.ThemeColor(
			'statusBarItem.errorBackground'
		);
		this.item.tooltip = 'Click to stop dictation';
	}

	/** Shows continuous recording state with optional segment count and processing indicator. */
	setRecordingContinuous(segmentsInserted?: number, processingSegment?: boolean): void {
		if (processingSegment && segmentsInserted !== undefined) {
			this.item.text = `$(circle-filled) Recording | Processing seg ${segmentsInserted + 1}...`;
		} else if (segmentsInserted !== undefined && segmentsInserted > 0) {
			this.item.text = `$(circle-filled) Recording (${segmentsInserted} segments inserted)`;
		} else {
			this.item.text = '$(circle-filled) Continuous Recording...';
		}
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		this.item.tooltip = 'Click to stop continuous dictation';
	}

	/** Shows a spinner while transcription is in progress, indicating the active provider. */
	setTranscribing(): void {
		const suffix = this._provider === 'local' ? ' (local)' : '';
		this.item.text = `$(loading~spin) Transcribing${suffix}...`;
		this.item.backgroundColor = undefined;
		this.item.tooltip = this._provider === 'local'
			? 'Transcribing audio via whisper.cpp...'
			: 'Transcribing audio via OpenAI Whisper...';
	}

	/** Shows a spinner during Claude post-processing, optionally with a live character count. */
	setProcessing(charCount?: number): void {
		this.item.text = charCount !== undefined
			? `$(loading~spin) Processing... ${charCount} chars`
			: '$(loading~spin) Processing...';
		this.item.backgroundColor = undefined;
		this.item.tooltip = 'Processing dictation...';
	}

	/** Disposes the underlying VS Code status bar item. */
	dispose(): void {
		this.item.dispose();
	}
}
