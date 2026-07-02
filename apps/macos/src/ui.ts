import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Minimal DOM UI for the (normally hidden) main window. M2 uses it to show a
 * transcript and to collect the Deepgram API key; M3 adds the Accessibility
 * onboarding message. A richer settings UI comes in M4.
 */

/** Brings the main window to the foreground. */
async function reveal(): Promise<void> {
	try {
		const win = getCurrentWindow();
		await win.show();
		await win.setFocus();
	} catch (err) {
		console.warn('[Verba] Failed to reveal window:', err);
	}
}

function setStatus(text: string): void {
	const status = document.getElementById('status');
	if (status) { status.textContent = text; }
}

/** Shows the given transcript text in the window. */
export async function showTranscript(text: string): Promise<void> {
	await reveal();
	const out = document.getElementById('transcript') ?? createTranscriptEl();
	out.textContent = text;
	setStatus('Transcript:');
}

function createTranscriptEl(): HTMLElement {
	const el = document.createElement('pre');
	el.id = 'transcript';
	el.style.whiteSpace = 'pre-wrap';
	document.getElementById('app')?.appendChild(el);
	return el;
}

/** Reflects recording/processing state in the window status line. */
export function setPhase(text: string): void {
	setStatus(text);
}

/**
 * Prompts the user for an API key in the main window and resolves with the
 * entered value (or undefined if cancelled). Used as the core `ApiKeyPrompt`.
 */
export async function promptForApiKey(label: string): Promise<string | undefined> {
	await reveal();
	return new Promise((resolve) => {
		const app = document.getElementById('app');
		if (!app) { resolve(undefined); return; }

		const form = document.createElement('form');
		const input = document.createElement('input');
		input.type = 'password';
		input.placeholder = label;
		input.autofocus = true;
		const submit = document.createElement('button');
		submit.type = 'submit';
		submit.textContent = 'Save';
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.textContent = 'Cancel';

		const cleanup = () => form.remove();
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const value = input.value.trim();
			cleanup();
			resolve(value.length > 0 ? value : undefined);
		});
		cancel.addEventListener('click', () => {
			cleanup();
			resolve(undefined);
		});

		form.append(input, submit, cancel);
		app.appendChild(form);
		input.focus();
	});
}

/**
 * Shows an Accessibility-permission onboarding message with a button that
 * opens System Settings. Resolves once the user dismisses it — clicking
 * "Open System Settings" does not dismiss the box, since the user needs to
 * switch away to System Settings and back before retrying the hotkey.
 */
export async function showAccessibilityOnboarding(onOpenSettings: () => Promise<void>): Promise<void> {
	await reveal();
	if (document.getElementById('accessibility-onboarding')) { return; }

	const app = document.getElementById('app');
	if (!app) {
		console.warn('[Verba] Cannot show Accessibility onboarding: #app element not found');
		return;
	}

	return new Promise((resolve) => {
		const box = document.createElement('div');
		box.id = 'accessibility-onboarding';

		const message = document.createElement('p');
		message.textContent =
			'Verba needs Accessibility permission to paste into other apps. ' +
			'Grant it in System Settings, then press the hotkey again to dictate.';

		const openSettings = document.createElement('button');
		openSettings.type = 'button';
		openSettings.textContent = 'Open System Settings';
		openSettings.addEventListener('click', () => {
			onOpenSettings().catch((err) => {
				console.warn('[Verba] Failed to open Accessibility settings:', err);
				message.textContent =
					'Could not open System Settings automatically. Open it manually: ' +
					'System Settings → Privacy & Security → Accessibility.';
			});
		});

		const dismiss = document.createElement('button');
		dismiss.type = 'button';
		dismiss.textContent = 'Dismiss';
		dismiss.addEventListener('click', () => {
			box.remove();
			resolve();
		});

		box.append(message, openSettings, dismiss);
		app.appendChild(box);
	});
}
