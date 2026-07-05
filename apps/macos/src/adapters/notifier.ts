import type { Notifier } from '@verba/core';
import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from '@tauri-apps/plugin-notification';

/**
 * macOS implementation of the core {@link Notifier} seam, backed by native
 * notifications (Tauri notification plugin). All methods are best-effort and
 * never throw — the core treats notifications as non-critical side effects.
 */
export class TauriNotifier implements Notifier {
	/**
	 * Requests notification permission once; call during app startup. Callers
	 * don't need to await this before calling `warn`/`info`/`error` — `send`
	 * always attempts the native call regardless of whether this has resolved
	 * yet, so an error occurring before permission is granted still reaches
	 * the OS notification API (and is a no-op there) rather than being
	 * silently downgraded to a console-only warning.
	 */
	async init(): Promise<void> {
		try {
			const granted = await isPermissionGranted();
			if (!granted) {
				await requestPermission();
			}
		} catch (err) {
			console.warn('[Verba] Notification permission request failed:', err);
		}
	}

	warn(message: string): void {
		this.send('Verba', message);
	}

	info(message: string): void {
		this.send('Verba', message);
	}

	error(message: string): void {
		this.send('Verba', message);
	}

	private send(title: string, body: string): void {
		try {
			sendNotification({ title, body });
		} catch (err) {
			console.warn('[Verba] Failed to show notification:', err);
		}
	}
}
