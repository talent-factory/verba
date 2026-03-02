/**
 * Quick Pick UI building blocks for the dictation history browser.
 */

import { formatRelativeTime, HistoryRecord } from './historyManager';

export interface HistoryQuickPickItem {
	label: string;
	description?: string;
	detail?: string;
	record: HistoryRecord;
}

export interface ActionQuickPickItem {
	label: string;
	description?: string;
	id: 'insert' | 'copy' | 'details';
}

const MAX_TEXT_LENGTH = 80;

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.slice(0, maxLength - 1) + '\u2026';
}

/**
 * Maps history records to Quick Pick items for display.
 */
export function buildHistoryItems(records: HistoryRecord[]): HistoryQuickPickItem[] {
	return records.map(record => ({
		label: `$(clock) ${formatRelativeTime(record.timestamp)} \u00B7 ${record.templateName}`,
		description: truncate(record.cleanedText, MAX_TEXT_LENGTH),
		detail: truncate(record.rawTranscript, MAX_TEXT_LENGTH),
		record,
	}));
}

/**
 * Returns the action items for the history record action picker.
 */
export function buildActionItems(): ActionQuickPickItem[] {
	return [
		{ label: '$(insert) Insert into Editor', description: 'Insert the cleaned text at cursor position', id: 'insert' },
		{ label: '$(clippy) Copy to Clipboard', description: 'Copy the cleaned text to clipboard', id: 'copy' },
		{ label: '$(info) Show Details', description: 'View full transcript and metadata', id: 'details' },
	];
}
