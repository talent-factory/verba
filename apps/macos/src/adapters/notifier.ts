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
	private granted = false;

	/** Requests notification permission once; call during app startup. */
	async init(): Promise<void> {
		try {
			this.granted = await isPermissionGranted();
			if (!this.granted) {
				this.granted = (await requestPermission()) === 'granted';
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
			if (this.granted) {
				sendNotification({ title, body });
			} else {
				console.warn(`[Verba] (notification suppressed, no permission) ${body}`);
			}
		} catch (err) {
			console.warn('[Verba] Failed to show notification:', err);
		}
	}
}
