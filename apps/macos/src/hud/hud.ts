import { listen } from '@tauri-apps/api/event';

interface HudPayload { label: string; icon: string; accent: string; }

/** Renders the pill from a pushed state payload. */
function render(p: HudPayload): void {
	const icon = document.getElementById('icon');
	const label = document.getElementById('label');
	const pill = document.getElementById('pill');
	if (icon) { icon.textContent = p.icon; }
	if (label) { label.textContent = p.label; }
	if (pill && p.accent) { pill.style.setProperty('--accent', p.accent); }
}

void listen<HudPayload>('hud:state', (event) => render(event.payload));
