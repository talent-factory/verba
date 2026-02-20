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

	setIdle(): void {
		this.item.text = '$(mic) Verba';
		this.item.backgroundColor = undefined;
		this.item.tooltip = 'Click to start dictation';
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

	dispose(): void {
		this.item.dispose();
	}
}
