import { register } from '@tauri-apps/plugin-global-shortcut';
import { DictationController } from './controller';

/** Default global hotkey. User-configurable later (M4); avoids common clashes. */
const HOTKEY = 'Alt+Space';

async function main(): Promise<void> {
	const controller = new DictationController();
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
