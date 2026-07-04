import { register } from '@tauri-apps/plugin-global-shortcut';
import { listen } from '@tauri-apps/api/event';
import { createDictationController } from './wiring';

/** Default global hotkey. User-configurable later (M4); avoids common clashes. */
const HOTKEY = 'Control+Alt+D';

async function main(): Promise<void> {
	const { controller, reloadConfig } = await createDictationController();
	void listen('config:changed', () => { void reloadConfig(); });
	await controller.init();

	try {
		await register(HOTKEY, (event) => {
			// The plugin fires for both press and release; act on press only.
			if (event.state === 'Pressed') {
				void controller.handleHotkey();
			}
		});
		setStatus(`Ready — press ${HOTKEY} to dictate.`);
	} catch (err) {
		console.error('[Verba] Failed to register global shortcut:', err);
		setStatus(`Could not register ${HOTKEY}. Another app may already use it.`);
	}
}

function setStatus(text: string): void {
	const status = document.getElementById('status');
	if (status) { status.textContent = text; }
}

void main();
