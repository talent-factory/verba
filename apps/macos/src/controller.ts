import type { CleanupService } from '@verba/core';

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Window-UI surface the controller drives (implemented by `ui.ts`). */
export interface ControllerUi {
	setPhase(text: string): void;
	showTranscript(text: string): Promise<void>;
	showAccessibilityOnboarding(onOpenSettings: () => Promise<void>): Promise<void>;
}

/**
 * Everything the controller needs from the host, injected so the dictation
 * flow is unit-testable: `@tauri-apps/api` is ESM-only and cannot be loaded
 * by the CommonJS test build, so no module under test may import it directly
 * (same pattern as `DeepgramTauriProvider`). `wiring.ts` builds the real set.
 */
export interface ControllerDeps {
	deepgram: { transcribe(audioPath: string): Promise<{ text: string; detectedLanguage?: string }> };
	cleanup: Pick<CleanupService, 'process'>;
	notifier: { init(): Promise<void>; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
	store: { init(): Promise<void> };
	invoke: InvokeFn;
	ui: ControllerUi;
}

/**
 * Owns the dictation flow on top of injected host adapters.
 *
 * **M2 (shipped):** the hotkey toggles microphone capture; on stop, the
 * recording is transcribed and the transcript is shown in the window.
 *
 * **M3 (this milestone):** the transcript runs through `CleanupService`
 * (raw-transcript fallback when the key prompt is cancelled or the API
 * fails) and is pasted into the frontmost app via `paste_text`. The window
 * only appears for the Accessibility onboarding or when pasting fails.
 */
export class DictationController {
	private recording = false;
	private working = false;

	constructor(private readonly deps: ControllerDeps) {}

	/** Requests permissions and loads persisted state. Call once at startup. */
	async init(): Promise<void> {
		// Don't block startup (and hotkey registration in main.ts) on the
		// notification-permission dialog: it's best-effort per the Notifier
		// contract, and on this menu-bar (Accessory-policy) app the system
		// dialog isn't reliably raised to the front, so awaiting it can hang
		// indefinitely with no visible sign anything is wrong.
		void this.deps.notifier.init();
		await this.deps.store.init();
	}

	/**
	 * Invoked by the global hotkey. First press starts capture; second press
	 * stops it, transcribes, cleans up, and pastes.
	 */
	async handleHotkey(): Promise<void> {
		if (this.working) { return; }

		if (!this.recording) {
			await this.startRecording();
			return;
		}
		await this.stopAndTranscribe();
	}

	private async startRecording(): Promise<void> {
		try {
			await this.deps.invoke('start_capture');
			this.recording = true;
			this.deps.ui.setPhase('Recording… press the hotkey again to stop.');
			this.deps.notifier.info('Verba: recording…');
		} catch (err) {
			this.deps.notifier.error(`Verba: could not start recording — ${errText(err)}`);
		}
	}

	private async stopAndTranscribe(): Promise<void> {
		this.working = true;
		this.recording = false;
		try {
			const wavPath = await this.deps.invoke<string>('stop_capture');
			this.deps.ui.setPhase('Transcribing…');
			const { text: transcript, detectedLanguage } = await this.deps.deepgram.transcribe(wavPath);

			this.deps.ui.setPhase('Processing…');
			let text = transcript;
			try {
				text = await this.deps.cleanup.process(transcript, { detectedLanguage });
			} catch (err) {
				// Cleanup is refinement, not a gate: a cancelled key prompt or an
				// API failure must never cost the user their dictation.
				this.deps.notifier.warn(`Verba: cleanup skipped — using raw transcript (${errText(err)})`);
			}

			const hasAccessibility = await this.deps.invoke<boolean>('has_accessibility_permission');
			if (!hasAccessibility) {
				await this.deps.ui.showAccessibilityOnboarding(() => this.deps.invoke('open_accessibility_settings'));
				await this.deps.ui.showTranscript(text);
				return;
			}

			try {
				await this.deps.invoke('paste_text', { text });
				this.deps.notifier.info('Verba: pasted.');
				this.deps.ui.setPhase('Idle.');
			} catch (err) {
				// The window is the fallback surface: the user must never lose text.
				this.deps.notifier.error(`Verba: paste failed — ${errText(err)}`);
				await this.deps.ui.showTranscript(text);
			}
		} catch (err) {
			this.deps.notifier.error(`Verba: ${errText(err)}`);
			this.deps.ui.setPhase('Idle.');
		} finally {
			this.working = false;
		}
	}
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
