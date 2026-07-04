/** The discrete dictation-flow state that drives both visualization surfaces. */
export type DictationState = 'idle' | 'recording' | 'transcribing' | 'processing';

/** Everything the tray adapter and the HUD need to render a given state. */
export interface Presentation {
	hudVisible: boolean;
	hudIcon: string;
	hudLabel: string;
	hudAccent: string;
	trayTooltip: string;
	trayTitle: string;
}

const TABLE: Record<DictationState, Presentation> = {
	idle: {
		hudVisible: false, hudIcon: '', hudLabel: '', hudAccent: '',
		trayTooltip: 'Verba — bereit', trayTitle: '',
	},
	recording: {
		hudVisible: true, hudIcon: '🎙', hudLabel: 'Aufnahme …', hudAccent: '#e5484d',
		trayTooltip: 'Verba — Aufnahme', trayTitle: '●',
	},
	transcribing: {
		hudVisible: true, hudIcon: '⏺', hudLabel: 'Transkribiere …', hudAccent: '#f5a623',
		trayTooltip: 'Verba — Transkribiere', trayTitle: '…',
	},
	processing: {
		hudVisible: true, hudIcon: '⚙', hudLabel: 'Verarbeite mit Claude …', hudAccent: '#3b82f6',
		trayTooltip: 'Verba — Verarbeite', trayTitle: '…',
	},
};

/** Pure state → presentation mapping. The single source of the German copy. */
export function presentationFor(state: DictationState): Presentation {
	return TABLE[state];
}
