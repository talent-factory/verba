import type { DetectedSurface } from '@verba/core';

/** Whether a dictation should be inserted only, or inserted and submitted. */
export type Intent = 'insert' | 'submit';

/** Injected primitives the router drives; wiring.ts supplies the Tauri-backed set. */
export interface DeliveryPorts {
	/** Current frontmost surface (detected at delivery time — the target is "now"). */
	detectSurface(): Promise<DetectedSurface>;
	/** Type text into the herdr pane; submit → also send Enter. */
	herdrSend(paneId: string, text: string, submit: boolean): Promise<void>;
	/** Clipboard + ⌘V paste into the frontmost app. */
	paste(text: string): Promise<void>;
	/** Synthetic Return into the frontmost app. */
	pressEnter(): Promise<void>;
}

/**
 * Routes a finished transcript to where it belongs:
 * - focused agent pane with a pane id → herdr (submit sends Enter itself);
 * - anything else → clipboard paste; Enter only follows on an agent surface.
 * The surface is detected here, at delivery time, so the target matches whatever
 * is frontmost now (same semantics the blind paste had).
 */
export async function deliver(text: string, intent: Intent, ports: DeliveryPorts): Promise<void> {
	const submit = intent === 'submit';
	let surface: DetectedSurface;
	try {
		surface = await ports.detectSurface();
	} catch {
		surface = { class: 'generic' };
	}

	if (surface.class === 'agent' && surface.paneId) {
		try {
			await ports.herdrSend(surface.paneId, text, submit);
			return;
		} catch {
			// herdr unreachable → fall through to the paste path below.
		}
	}

	await ports.paste(text);
	// Submit's Enter is an agent-only affordance; never fire it into Notes/editors.
	if (submit && surface.class === 'agent') {
		await ports.pressEnter();
	}
}
