import * as vscode from 'vscode';

export class StatusBarManager {
	private item: vscode.StatusBarItem;

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100
		);
		this.item.command = 'dictation.start';
		this.setIdle();
		this.item.show();
	}

	setIdle(templateName?: string): void {
		this.item.text = templateName
			? `$(mic) Verba: ${templateName}`
			: '$(mic) Verba';
		this.item.backgroundColor = undefined;
		this.item.tooltip = templateName
			? `Active template: ${templateName} — Click to start dictation`
			: 'Click to start dictation';
	}

	setRecording(): void {
		this.item.text = '$(circle-filled) Recording...';
		this.item.backgroundColor = new vscode.ThemeColor(
			'statusBarItem.errorBackground'
		);
		this.item.tooltip = 'Click to stop dictation';
	}

	setTranscribing(): void {
		this.item.text = '$(loading~spin) Transcribing...';
		this.item.backgroundColor = undefined;
		this.item.tooltip = 'Transcribing audio...';
	}

	setProcessing(charCount?: number): void {
		this.item.text = charCount !== undefined
			? `$(loading~spin) Processing... ${charCount} chars`
			: '$(loading~spin) Processing...';
		this.item.backgroundColor = undefined;
		this.item.tooltip = 'Processing dictation...';
	}

	dispose(): void {
		this.item.dispose();
	}
}
