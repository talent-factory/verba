import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { presentationFor, type DictationState } from './statePresentation';
import { accentForSeverity, type HudMessage } from './messagePresentation';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Drives the two visualization surfaces (tray + HUD) from a dictation state.
 * All calls are best-effort — a failed IPC is logged and swallowed so the
 * dictation flow is never affected.
 */
export function createVisualization(
	invoke: Invoke = tauriInvoke,
): { setState(state: DictationState): void; showMessage(message: HudMessage): void } {
	return {
		setState(state: DictationState): void {
			const p = presentationFor(state);
			void invoke('set_tray_state', { state, tooltip: p.trayTooltip, title: p.trayTitle })
				.catch((err) => console.warn('[Verba] set_tray_state failed:', err));
			void invoke('set_hud_state', { state, label: p.hudLabel, icon: p.hudIcon, accent: p.hudAccent })
				.catch((err) => console.warn('[Verba] set_hud_state failed:', err));
		},
		showMessage(message: HudMessage): void {
			// The flow is done → tray returns to idle, while the HUD shows the
			// actionable message for its own lifetime (owned by the controller).
			const idle = presentationFor('idle');
			void invoke('set_tray_state', { state: 'idle', tooltip: idle.trayTooltip, title: idle.trayTitle })
				.catch((err) => console.warn('[Verba] set_tray_state failed:', err));
			void invoke('set_hud_message', {
				label: message.label,
				icon: message.icon,
				accent: accentForSeverity(message.severity),
			}).catch((err) => console.warn('[Verba] set_hud_message failed:', err));
		},
	};
}
