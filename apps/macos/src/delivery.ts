import type { DetectedSurface } from '@verba/core';

/** Whether a dictation should be inserted only, or inserted and submitted. */
export type Intent = 'insert' | 'submit';

/**
 * Result of the clipboard-paste port. `'pasted'` on the normal path; under
 * Secure Event Input the synthetic ⌘V is swallowed by the OS, so the port
 * instead leaves the transcript on the clipboard and reports `'secure-input'`
 * for the caller to tell the user to paste manually.
 */
export type PasteOutcome = 'pasted' | 'secure-input';

/** How a transcript was delivered — routed to herdr, pasted, or blocked by secure input. */
export type DeliveryOutcome = 'herdr' | 'pasted' | 'secure-input';

/** Injected primitives the router drives; wiring.ts supplies the Tauri-backed set. */
export interface DeliveryPorts {
	/** Current frontmost surface (detected at delivery time — the target is "now"). */
	detectSurface(): Promise<DetectedSurface>;
	/** Type text into the herdr pane; submit → also send Enter. */
	herdrSend(paneId: string, text: string, submit: boolean): Promise<void>;
	/**
	 * Clipboard + ⌘V paste into the frontmost app. Returns `'secure-input'`
	 * (having left the transcript on the clipboard, un-pasted) when Secure Event
	 * Input blocks the synthetic keystroke; `'pasted'` otherwise.
	 */
	paste(text: string): Promise<PasteOutcome>;
	/** Synthetic Return into the frontmost app. */
	pressEnter(): Promise<void>;
}

/**
 * Routes a finished transcript to where it belongs:
 * - focused agent pane with a pane id → herdr (submit sends Enter itself);
 * - anything else → clipboard paste; Enter only follows on an agent surface.
 * The surface is detected here, at delivery time, so the target matches whatever
 * is frontmost now (same semantics the blind paste had).
 *
 * Returns how the text was delivered so the caller can notify appropriately —
 * notably `'secure-input'`, where the paste was blocked and the transcript was
 * left on the clipboard for the user to paste manually.
 */
export async function deliver(text: string, intent: Intent, ports: DeliveryPorts): Promise<DeliveryOutcome> {
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
			return 'herdr';
		} catch {
			// herdr unreachable → fall through to the paste path below.
		}
	}

	const outcome = await ports.paste(text);
	// Secure Event Input swallowed the paste: the transcript is on the clipboard
	// for the user to paste manually. A synthetic Enter would be swallowed too,
	// so skip it and let the caller surface the manual-paste hint.
	if (outcome === 'secure-input') {
		return 'secure-input';
	}
	// Submit's Enter is an agent-only affordance; never fire it into Notes/editors.
	if (submit && surface.class === 'agent') {
		await ports.pressEnter();
	}
	return 'pasted';
}
