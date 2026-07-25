import { register } from '@tauri-apps/plugin-global-shortcut';
import { listen } from '@tauri-apps/api/event';
import { createDictationController } from './wiring';

/** Default global hotkey. User-configurable later (M4); avoids common clashes. */
const HOTKEY = 'Control+Alt+D';

async function main(): Promise<void> {
	const { controller, reloadConfig, notifier, activationMode } = await createDictationController();
	void listen('config:changed', () => { void reloadConfig(); });
	// The tray (Rust) emits this when it can't persist a settings change; on an
	// Accessory app stderr/console are invisible, so relay it to a notification.
	void listen<string>('config:error', (event) => { notifier.error(`Verba: ${event.payload}`); });
	await controller.init();

	// Push-to-Talk (primary path when configured). This listens on a Rust
	// CGEventTap unrelated to the `@tauri-apps/plugin-global-shortcut`
	// registration below, so it's wired unconditionally here — a toggle-hotkey
	// conflict (caught below) must not also take PTT down with it.
	void listen<string>('ptt:down', (event) => {
		if (activationMode() !== 'push-to-talk') { return; }
		void controller.handlePttDown(event.payload === 'submit' ? 'submit' : 'insert');
	});
	void listen('ptt:up', () => {
		if (activationMode() !== 'push-to-talk') { return; }
		void controller.handlePttUp();
	});

	try {
		await register(HOTKEY, (event) => {
			// The plugin fires for both press and release; act on press only.
			if (event.state === 'Pressed') {
				void controller.handleHotkey();
			}
		});
		setStatus(`Ready — press ${HOTKEY} to dictate.`);
	} catch (err) {
		// The main window is hidden at startup, so `setStatus` alone would leave a
		// dead hotkey with no visible explanation. Surface it via the menu bar.
		console.error('[Verba] Failed to register global shortcut:', err);
		notifier.error(
			`Verba: could not register the hotkey ${HOTKEY} — another app may already use it. The shortcut won't work until that's resolved.`,
		);
		setStatus(`Could not register ${HOTKEY}. Another app may already use it.`);
	}
}

function setStatus(text: string): void {
	const status = document.getElementById('status');
	if (status) { status.textContent = text; }
}

void main();
