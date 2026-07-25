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
 * outcomes that only exist on the router's own decisions: `'herdr'` (sent
 * to an agent pane and, on submit, submitted there), `'not-submitted'` (the
 * text landed — via herdr or paste — but the submit/Enter step failed, so the
 * user must press Enter manually), and `'needs-accessibility'` (the paste
 * path was about to run but Accessibility permission is missing; nothing was
 * delivered — the caller should show the Accessibility onboarding instead).
 */
export type DeliveryOutcome = PasteOutcome | 'herdr' | 'not-submitted' | 'needs-accessibility';

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
	/**
	 * Whether the app currently holds macOS Accessibility permission. Only
	 * consulted by the paste path — herdr delivery shells out to the `herdr`
	 * CLI and needs no Accessibility permission at all, so this must never be
	 * checked before the herdr branch has had its chance.
	 */
	hasAccessibility(): Promise<boolean>;
}

/**
 * Routes a finished transcript to where it belongs:
 * - focused agent pane with a pane id → herdr (submit sends Enter itself);
 * - anything else → clipboard paste; Enter only follows on an agent surface.
 * The surface is detected here, at delivery time, so the target matches whatever
 * is frontmost now (same semantics the blind paste had).
 *
 * Returns how the text was delivered so the caller can notify appropriately:
 * - `'herdr'` — delivered via the herdr CLI and (if requested) submitted there;
 *   `'pasted'` — delivered via clipboard + ⌘V. Submit's Enter is an
 *   agent-only affordance: it fires on `'herdr'` (herdr sends it itself) and,
 *   on the paste path, only when the surface is also `'agent'` (e.g. a paste
 *   fallback after herdr had no pane id) — it is intentionally SKIPPED for
 *   `'pasted'` on any non-agent surface, even when submit was requested, so a
 *   `'pasted'` outcome must never be reported to the user as "sent".
 * - `'not-submitted'` — the text landed (herdr send-text, or paste) but the
 *   Enter/submit step failed; the caller should tell the user to press Enter
 *   manually. The transcript is NOT re-delivered.
 * - `'secure-input'` — the paste was blocked and the transcript was left on
 *   the clipboard for the user to paste manually.
 * - `'needs-accessibility'` — the paste path was about to run but Accessibility
 *   permission is missing; nothing was delivered. This can NEVER happen on the
 *   herdr path (herdr needs no Accessibility at all) — only the paste branch
 *   checks it. The caller should show the Accessibility onboarding.
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

	// Accessibility is required only for the paste path (the synthetic ⌘V and
	// Enter are Accessibility-gated APIs); herdr, above, already returned and
	// never reaches here, so it is never blocked by a missing permission.
	if (!(await ports.hasAccessibility())) {
		return 'needs-accessibility';
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
