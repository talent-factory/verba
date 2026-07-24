import { NoSpeechError, type CleanupService } from '@verba/core';
import { deliver, type DeliveryPorts, type Intent } from './delivery';
import type { DictationState } from './visualization/statePresentation';
import { HUD_MESSAGES, type HudMessage } from './visualization/messagePresentation';

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Window-UI surface the controller drives (implemented by `ui.ts`). */
export interface ControllerUi {
	setPhase(text: string): void;
	setState(state: DictationState): void;
	showMessage(message: HudMessage): void;
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
	/**
	 * Upper bound on the recording-stop step (default {@link DEFAULT_STOP_CAPTURE_TIMEOUT_MS}).
	 * `stop_capture` blocks on a channel until the native capture thread finalizes the
	 * WAV and reports its path; the cpal/CoreAudio stream teardown deliberately runs
	 * *after* that, on the (never-joined) capture thread, so a teardown hang can no
	 * longer stall this step. The bound therefore guards the finalize handshake — a
	 * stuck `hound` finalize / disk, or the thread dying before it reports — turning an
	 * otherwise indefinite "Transcribing…" freeze into a recoverable idle+error.
	 * Overridable so tests can drive the timeout path without waiting.
	 */
	stopCaptureTimeoutMs?: number;
	/** Routing ports for delivering the finished transcript (agent pane / paste). */
	delivery: DeliveryPorts;
	/** Minimum hold before a press starts recording (default 200ms). */
	holdThresholdMs?: number;
	/** Schedules `fn` after `ms`; returns a canceller. Injectable for tests. */
	schedule?: (fn: () => void, ms: number) => () => void;
}

/**
 * Default cleanup timeout. The Claude cleanup call is normally a few seconds;
 * this is a safety ceiling that only trips on a genuine stall (network /
 * Anthropic slowness), turning an indefinite hang into the raw-transcript
 * fallback.
 */
const DEFAULT_CLEANUP_TIMEOUT_MS = 30_000;

/**
 * Default recording-stop timeout. Finalizing the WAV is normally instantaneous;
 * this only trips if that finalize handshake hangs (e.g. a stuck disk / `hound`
 * finalize) or the capture thread dies before reporting — not on the cpal stream
 * teardown, which now runs after `stop_capture` has already returned.
 */
const DEFAULT_STOP_CAPTURE_TIMEOUT_MS = 10_000;

/** How long an actionable HUD message stays before auto-hiding. */
const HUD_MESSAGE_MS = 5000;

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
	private readonly stopCaptureTimeoutMs: number;
	private readonly holdThresholdMs: number;
	private readonly schedule: (fn: () => void, ms: number) => () => void;
	// Intent for the *next* delivery. Set by the push-to-talk key that started the
	// hold; the toggle hotkey always resets it to 'insert'.
	private intent: Intent = 'insert';
	// Non-null while a push is held but the threshold hasn't elapsed yet; its
	// `cancel` disarms the pending start so a short tap never records.
	private arming: { cancel: () => void } | null = null;
	// Guards the window between "threshold elapsed" and "capture actually started",
	// so a release that races the async start is deferred, not dropped.
	private startInFlight = false;
	private pendingStop = false;
	private pendingHudMessage: HudMessage | null = null;
	private hudMessageTimer: (() => void) | null = null;

	constructor(private readonly deps: ControllerDeps) {
		this.cleanupTimeoutMs = deps.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
		this.stopCaptureTimeoutMs = deps.stopCaptureTimeoutMs ?? DEFAULT_STOP_CAPTURE_TIMEOUT_MS;
		this.holdThresholdMs = deps.holdThresholdMs ?? 200;
		this.schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
	}

	/** Updates the flow state and mirrors it to the visualization surfaces. */
	private setState(state: DictationState): void {
		// A new non-idle state (e.g. a fresh recording) takes over the pill, so a
		// still-pending HUD-message hide timer must be cancelled — otherwise it
		// would fire mid-flow and hide the HUD.
		if (state !== 'idle' && this.hudMessageTimer) {
			this.hudMessageTimer();
			this.hudMessageTimer = null;
		}
		this.state = state;
		this.deps.ui.setState(state);
	}

	/**
	 * Shows an actionable message on the HUD for HUD_MESSAGE_MS, then hides it.
	 * Tray goes idle immediately (the flow is done); the logical state is idle so
	 * a new hotkey press is accepted. Called from `finally` instead of the plain
	 * idle so the message isn't stomped by the flow's end-of-run idle.
	 */
	private surfaceHudMessage(message: HudMessage): void {
		this.state = 'idle';
		this.deps.ui.showMessage(message);
		this.hudMessageTimer?.();
		this.hudMessageTimer = this.schedule(() => {
			this.hudMessageTimer = null;
			this.deps.ui.setState('idle');
		}, HUD_MESSAGE_MS);
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
		// Symmetric with the PTT guards: a start already in flight (from a PTT
		// hold that just crossed the threshold) must not be raced by a second
		// `start_capture`. A pending PTT arm that hasn't fired yet is cancelled
		// so it can't fire later and start a second capture.
		if (this.startInFlight) { return; }
		if (this.arming) { this.arming.cancel(); this.arming = null; }
		if (this.state === 'idle') {
			// The toggle path has no held intent, so it always delivers as 'insert'.
			this.intent = 'insert';
			await this.startRecording();
			return;
		}
		await this.stopAndTranscribe();
	}

	/** Push-to-talk key pressed. Arms a hold timer; only a hold past the threshold records. */
	async handlePttDown(intent: Intent): Promise<void> {
		if (this.state !== 'idle' || this.arming || this.startInFlight) { return; }
		this.intent = intent;
		// `arm` is this hold's own identity token. A real scheduler's cancel()
		// (clearTimeout) already guarantees a cancelled timer never fires, but the
		// identity check below makes that guarantee explicit rather than assumed:
		// even if this closure somehow ran after `this.arming` was cleared or
		// replaced (cancelled by `handleHotkey`/`handlePttUp`, or superseded by a
		// newer arm), it must be a no-op instead of starting a second recording.
		const arm: { cancel: () => void } = { cancel: () => {} };
		arm.cancel = this.schedule(() => {
			if (this.arming !== arm) { return; }
			this.arming = null;
			void this.beginRecording();
		}, this.holdThresholdMs);
		this.arming = arm;
	}

	/** Push-to-talk key released. Short tap → cancel; held → stop and deliver. */
	async handlePttUp(): Promise<void> {
		if (this.arming) { this.arming.cancel(); this.arming = null; return; }
		if (this.startInFlight) { this.pendingStop = true; return; }
		if (this.state === 'recording') { await this.stopAndTranscribe(); }
	}

	/** Starts capture once the hold threshold has elapsed; handles a release that races the start. */
	private async beginRecording(): Promise<void> {
		this.startInFlight = true;
		await this.startRecording();
		this.startInFlight = false;
		if (this.pendingStop) {
			this.pendingStop = false;
			if (this.state === 'recording') { await this.stopAndTranscribe(); }
		}
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
			const wavPath = await this.stopCaptureWithTimeout();
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
				const outcome = await deliver(text, this.intent, this.deps.delivery);
				if (outcome === 'secure-input') {
					// Secure Event Input (e.g. a terminal with "Secure Keyboard Entry")
					// swallowed the synthetic ⌘V; the transcript is on the clipboard for
					// the user to paste manually. Warn distinctly so it doesn't look like
					// a normal paste that silently did nothing.
					this.deps.notifier.warn('Verba: Terminal blocked the paste (Secure Input) — transcript left on the clipboard, press ⌘V to insert.');
					this.pendingHudMessage = HUD_MESSAGES.secureInput;
				} else if (outcome === 'not-submitted') {
					// The text landed (herdr send-text, or paste) but the Enter/submit
					// step failed. Not a delivery failure — the transcript is NOT
					// re-delivered and NOT shown as failed, just a warn to press Enter.
					this.deps.notifier.warn('Verba: inserted but not submitted — press Enter to send.');
				} else {
					this.deps.notifier.info(this.intent === 'submit' ? 'Verba: sent.' : 'Verba: pasted.');
				}
				this.deps.ui.setPhase('Idle.');
			} catch (err) {
				// The window is the fallback surface: the user must never lose text.
				this.deps.notifier.error(`Verba: delivery failed — ${errText(err)}`);
				this.pendingHudMessage = HUD_MESSAGES.deliveryFailed;
				await this.deps.ui.showTranscript(text);
			}
		} catch (err) {
			if (err instanceof StopCaptureTimeoutError) {
				// The native capture thread hung while finalizing the WAV (the finalize
				// handshake never completed). Recover to idle instead of freezing forever
				// in "Transcribing…" — the recording is lost, but the app stays usable.
				this.deps.notifier.error(
					`Verba: recording could not be finalized (stop timed out after ${this.stopCaptureTimeoutMs}ms) — the audio device may be stuck; retry, and restart Verba if it persists.`
				);
			} else {
				if (err instanceof NoSpeechError) {
					this.pendingHudMessage = HUD_MESSAGES.noSpeech;
				}
				this.deps.notifier.error(`Verba: ${errText(err)}`);
			}
			this.deps.ui.setPhase('Idle.');
		} finally {
			if (this.pendingHudMessage) {
				const message = this.pendingHudMessage;
				this.pendingHudMessage = null;
				this.surfaceHudMessage(message);
			} else {
				this.setState('idle');
			}
		}
	}

	/**
	 * Runs the cleanup with an upper time bound. `run` receives an AbortSignal;
	 * on timeout we abort it and reject with a {@link CleanupTimeoutError} so the
	 * caller falls back to the raw transcript.
	 *
	 * The abort is best-effort and transport-dependent: it stops the SDK from
	 * starting a *new* retry, but the macOS transport (a Tauri `invoke`, see
	 * `anthropicTauriFetch.ts`) can't cancel a request already in flight, so that
	 * request runs to its own timeout and its Anthropic cost is still incurred.
	 * The user-visible flow never stalls regardless, because the timeout rejects
	 * on its own timer even if `run` never settles (a hang outside the request,
	 * e.g. a key prompt, is bounded too). A settle that arrives *after* the
	 * timeout can no longer change the outcome; its late result/rejection is
	 * logged (never lost) and kept from surfacing as an unhandledRejection.
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

	/**
	 * Invokes `stop_capture` with an upper time bound. The native capture thread
	 * finalizes the WAV and reports its path over a channel, which `stop_capture`
	 * awaits (`done_rx.recv()`) — it does *not* join the thread, and the cpal/CoreAudio
	 * stream teardown runs afterward off that path, so a teardown hang can't block here.
	 * Without this bound a stuck *finalize* (or a thread that dies before reporting)
	 * would still freeze the flow in "Transcribing…"; on timeout we reject with a
	 * {@link StopCaptureTimeoutError} and abandon the recording. Tauri's `invoke` can't
	 * be cancelled, so a genuinely stuck native thread leaks until the app restarts; a
	 * late settlement is logged (never lost) and consumed so it can't surface as an
	 * unhandledRejection.
	 */
	private stopCaptureWithTimeout(): Promise<string> {
		const op = this.deps.invoke<string>('stop_capture');
		return new Promise<string>((resolve, reject) => {
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				reject(new StopCaptureTimeoutError(this.stopCaptureTimeoutMs));
			}, this.stopCaptureTimeoutMs);
			op.then(
				(value) => {
					clearTimeout(timer);
					if (timedOut) {
						console.warn('[Verba] stop_capture resolved after timeout; recording was already abandoned');
						return;
					}
					resolve(value);
				},
				(err) => {
					clearTimeout(timer);
					if (timedOut) {
						console.warn(`[Verba] stop_capture rejected after timeout: ${errText(err)}`);
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

/** Raised by {@link DictationController} when finalizing the recording exceeds its time budget. */
class StopCaptureTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`stop_capture timed out after ${timeoutMs}ms`);
		this.name = 'StopCaptureTimeoutError';
	}
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
