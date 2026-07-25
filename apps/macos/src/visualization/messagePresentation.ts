/** Severity of an actionable HUD message. Drives the accent color. */
export type Severity = 'warn' | 'error';

/** A short, actionable message mirrored onto the HUD pill. */
export interface HudMessage {
	label: string;
	severity: Severity;
	/** Intentionally an unconstrained string, not a union: `HUD_MESSAGES` below is the
	 * sole producer and already locks its literals via `as const satisfies` — narrowing
	 * the type here would just re-derive that constraint and over-model it. */
	icon: string;
}

/**
 * The three actionable messages mirrored to the HUD — the single source of this
 * German copy. Icon is per-message (not per-severity): no-speech uses 🔇 while
 * the other error, delivery-failure, uses ⚠.
 */
export const HUD_MESSAGES = {
	secureInput: { label: '⌘V zum Einfügen', severity: 'warn', icon: '⚠' },
	noSpeech: { label: 'Keine Sprache erkannt', severity: 'error', icon: '🔇' },
	deliveryFailed: { label: 'Zustellung fehlgeschlagen', severity: 'error', icon: '⚠' },
} as const satisfies Record<string, HudMessage>;

/** Accent color for a severity: warn = amber, error = red. */
export function accentForSeverity(severity: Severity): string {
	switch (severity) {
		case 'warn':
			return '#f5a623';
		case 'error':
			return '#e5484d';
		default: {
			// Exhaustiveness check: a future 3rd Severity fails to compile here
			// instead of silently falling through to the error color.
			const _exhaustive: never = severity;
			throw new Error(`accentForSeverity: unhandled severity ${String(_exhaustive)}`);
		}
	}
}
