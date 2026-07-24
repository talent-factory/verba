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

/**
 * How a transcript was delivered. Derived from {@link PasteOutcome} plus the
 * two outcomes that only exist on the router's own decisions: `'herdr'` (sent
 * to an agent pane and, on submit, submitted there) and `'not-submitted'` (the
 * text landed — via herdr or paste — but the submit/Enter step failed, so the
 * user must press Enter manually).
 */
export type DeliveryOutcome = PasteOutcome | 'herdr' | 'not-submitted';

/** Injected primitives the router drives; wiring.ts supplies the Tauri-backed set. */
export interface DeliveryPorts {
	/** Current frontmost surface (detected at delivery time — the target is "now"). */
	detectSurface(): Promise<DetectedSurface>;
	/**
	 * Types text into the herdr pane via `pane send-text`; submit → also sends
	 * Enter via `pane send-keys`. Resolves `'delivered'` when the text landed
	 * (Enter also succeeded, or submit wasn't requested), or
	 * `'delivered-not-submitted'` when the text landed but the Enter step
	 * failed. Rejects ONLY when send-text itself failed — i.e. nothing landed
	 * in the pane — which is the sole condition under which the caller may
	 * safely fall back to pasting (falling back after a successful send-text
	 * would double-deliver the text).
	 */
	herdrSend(paneId: string, text: string, submit: boolean): Promise<'delivered' | 'delivered-not-submitted'>;
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
 * Returns how the text was delivered so the caller can notify appropriately:
 * - `'herdr'` / `'pasted'` — delivered and (if requested) submitted.
 * - `'not-submitted'` — the text landed (herdr send-text, or paste) but the
 *   Enter/submit step failed; the caller should tell the user to press Enter
 *   manually. The transcript is NOT re-delivered.
 * - `'secure-input'` — the paste was blocked and the transcript was left on
 *   the clipboard for the user to paste manually.
 *
 * The paste fallback runs ONLY when nothing was delivered to the pane: herdr's
 * `herdrSend` rejects exclusively when send-text itself failed, so a rejection
 * here always means the pane never received the text. If herdr already typed
 * the text and only the Enter failed, `herdrSend` resolves `'delivered-not-submitted'`
 * instead of rejecting — closing the double-delivery edge where a partial
 * herdr failure used to fall through to paste and retype text that had
 * already landed.
 */
export async function deliver(text: string, intent: Intent, ports: DeliveryPorts): Promise<DeliveryOutcome> {
	const submit = intent === 'submit';
	let surface: DetectedSurface;
	try {
		surface = await ports.detectSurface();
	} catch (err) {
		console.warn('[Verba] surface detection failed, delivering via paste:', err);
		surface = { class: 'generic' };
	}

	if (surface.class === 'agent' && surface.paneId) {
		try {
			const r = await ports.herdrSend(surface.paneId, text, submit);
			return r === 'delivered-not-submitted' ? 'not-submitted' : 'herdr';
		} catch (err) {
			// send-text failed → nothing landed in the pane → safe to fall through to paste.
			console.warn('[Verba] herdr delivery failed, falling back to paste:', err);
		}
	}

	const outcome = await ports.paste(text); // may throw → genuine failure, propagates
	// Secure Event Input swallowed the paste: the transcript is on the clipboard
	// for the user to paste manually. A synthetic Enter would be swallowed too,
	// so skip it and let the caller surface the manual-paste hint.
	if (outcome === 'secure-input') {
		return 'secure-input';
	}
	// Submit's Enter is an agent-only affordance; never fire it into Notes/editors.
	if (submit && surface.class === 'agent') {
		try {
			await ports.pressEnter();
		} catch (err) {
			// The text IS pasted; only the Enter failed. Do NOT report total failure.
			console.warn('[Verba] paste succeeded but Enter failed:', err);
			return 'not-submitted';
		}
	}
	return 'pasted';
}
