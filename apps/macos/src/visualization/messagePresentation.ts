/** Severity of an actionable HUD message. Drives the accent color. */
export type Severity = 'warn' | 'error';

/** A short, actionable message mirrored onto the HUD pill. */
export interface HudMessage {
	label: string;
	severity: Severity;
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
	return severity === 'warn' ? '#f5a623' : '#e5484d';
}
