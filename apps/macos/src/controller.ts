import type { CleanupService } from '@verba/core';
import type { DictationState } from './visualization/statePresentation';

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Window-UI surface the controller drives (implemented by `ui.ts`). */
export interface ControllerUi {
	setPhase(text: string): void;
	setState(state: DictationState): void;
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
	/**
	 * Upper bound on the cleanup step (default {@link DEFAULT_CLEANUP_TIMEOUT_MS}).
	 * A stalled Claude call must never hang the flow; on timeout we fall back to
	 * the raw transcript, exactly as for an outright cleanup error. Overridable
	 * so tests can drive the timeout path without waiting.
	 */
	cleanupTimeoutMs?: number;
}

/**
 * Default cleanup timeout. The Claude cleanup call is normally a few seconds;
 * this is a safety ceiling that only trips on a genuine stall (network /
 * Anthropic slowness), turning an indefinite hang into the raw-transcript
 * fallback.
 */
const DEFAULT_CLEANUP_TIMEOUT_MS = 30_000;

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
	// Single source of truth for the flow. The visualization state and the
	// hotkey guards read the SAME field, so they can never drift and the
	// impossible "recording while also processing" combination (which a pair of
	// booleans would admit) is unrepresentable. Mutate only via `setState`.
	private state: DictationState = 'idle';
	private readonly cleanupTimeoutMs: number;

	constructor(private readonly deps: ControllerDeps) {
		this.cleanupTimeoutMs = deps.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
	}

	/** Updates the flow state and mirrors it to the visualization surfaces. */
	private setState(state: DictationState): void {
		this.state = state;
		this.deps.ui.setState(state);
	}

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
		// Busy (transcribing/processing) → ignore. Idle → start. Recording → stop.
		if (this.state === 'transcribing' || this.state === 'processing') { return; }
		if (this.state === 'idle') {
			await this.startRecording();
			return;
		}
		await this.stopAndTranscribe();
	}

	private async startRecording(): Promise<void> {
		try {
			await this.deps.invoke('start_capture');
			this.deps.ui.setPhase('Recording… press the hotkey again to stop.');
			this.setState('recording');
			this.deps.notifier.info('Verba: recording…');
		} catch (err) {
			// Stay idle: never entered the recording state, so the hotkey can retry.
			this.deps.notifier.error(`Verba: could not start recording — ${errText(err)}`);
		}
	}

	private async stopAndTranscribe(): Promise<void> {
		// Leave 'recording' synchronously (before the first await) so a re-entrant
		// hotkey press during transcription is ignored by `handleHotkey`.
		this.deps.ui.setPhase('Transcribing…');
		this.setState('transcribing');
		try {
			const wavPath = await this.deps.invoke<string>('stop_capture');
			const { text: transcript, detectedLanguage } = await this.deps.deepgram.transcribe(wavPath);

			this.deps.ui.setPhase('Processing…');
			this.setState('processing');
			let text = transcript;
			try {
				// A stall (not just a thrown error) must also fall back: the Anthropic
				// call has no short timeout of its own, so without this a hung request
				// would freeze the flow in "Processing…" indefinitely instead of
				// pasting the raw transcript.
				text = await this.withCleanupTimeout((signal) =>
					this.deps.cleanup.process(transcript, { detectedLanguage }, signal)
				);
			} catch (err) {
				// Cleanup is refinement, not a gate: a cancelled key prompt, an
				// API failure, or a timeout must never cost the user their dictation.
				if (err instanceof CleanupTimeoutError) {
					// A stall is systemic (network down / Anthropic outage), unlike a
					// benign cancelled key prompt — surface it distinctly so a
					// degraded service is noticeable rather than looking like a skip.
					this.deps.notifier.warn(`Verba: cleanup timed out after ${this.cleanupTimeoutMs}ms — Claude may be unreachable; using raw transcript.`);
				} else {
					this.deps.notifier.warn(`Verba: cleanup skipped — using raw transcript (${errText(err)})`);
				}
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
			this.setState('idle');
		}
	}

	/**
	 * Runs the cleanup with an upper time bound. `run` receives an AbortSignal;
	 * on timeout we abort it — cancelling the in-flight request so no work or API
	 * cost is wasted on a result we'll discard — and reject with a
	 * {@link CleanupTimeoutError} so the caller falls back to the raw transcript.
	 *
	 * The signal is best-effort: a request that ignores it (or a hang outside the
	 * request, e.g. a key prompt) still can't stall the flow, because the timeout
	 * rejects regardless. A settle that arrives *after* the timeout can no longer
	 * change the outcome; its late result/rejection is logged (never lost) and
	 * kept from surfacing as an unhandledRejection.
	 */
	private withCleanupTimeout(run: (signal: AbortSignal) => Promise<string>): Promise<string> {
		const controller = new AbortController();
		return new Promise<string>((resolve, reject) => {
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort();
				reject(new CleanupTimeoutError(this.cleanupTimeoutMs));
			}, this.cleanupTimeoutMs);
			run(controller.signal).then(
				(value) => {
					clearTimeout(timer);
					if (timedOut) {
						console.warn('[Verba] cleanup completed after timeout; raw transcript already used');
						return;
					}
					resolve(value);
				},
				(err) => {
					clearTimeout(timer);
					if (timedOut) {
						// Already fell back to the raw transcript. Log the real cause
						// (the abort we triggered, or a late API error) so a stall's
						// root cause isn't lost, and consume it here so it can't
						// surface as an unhandledRejection.
						console.warn(`[Verba] cleanup rejected after timeout: ${errText(err)}`);
						return;
					}
					reject(err);
				}
			);
		});
	}
}

/** Raised by {@link DictationController} when cleanup exceeds its time budget. */
class CleanupTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`cleanup timed out after ${timeoutMs}ms`);
		this.name = 'CleanupTimeoutError';
	}
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
