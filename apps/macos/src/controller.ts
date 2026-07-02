import { CleanupService, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { DeepgramTauriProvider } from './deepgramTauriProvider';
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';

/** CleanupService needs a host prompt for its API key; supply it via the window UI. */
class TauriCleanupService extends CleanupService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return promptForApiKey('Anthropic API key (sk-ant-…)');
	}
}

/**
 * Wires `@verba/core` to the macOS host adapters and owns the dictation flow.
 *
 * **M2 (shipped):** the hotkey toggles microphone capture; on stop, the
 * recording is transcribed and the transcript is shown in the window.
 * Keychain-backed secrets; a window prompt for API keys.
 *
 * **M3, onboarding-UI slice (this milestone):** after each transcription, a
 * passive Accessibility-permission check runs; when ungranted, an onboarding
 * message with a System-Settings deep-link is shown before falling through to
 * the existing transcript display. Real paste and {@link CleanupService} are a
 * separate, higher-risk follow-up slice. Transcription uses
 * {@link DeepgramTauriProvider} (a native Rust HTTP call) rather than
 * `@verba/core`'s SDK-based `DeepgramProvider`, which cannot run inside a
 * WebView — see that class's doc comment for why.
 */
export class DictationController {
	private readonly secrets = new TauriSecretStore();
	private readonly store = new TauriKeyValueStore();
	private readonly notifier = new TauriNotifier();
	private readonly deepgram: DeepgramTauriProvider;
	private readonly cleanup: CleanupService;
	private recording = false;
	private working = false;

	constructor() {
		const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

		this.deepgram = new DeepgramTauriProvider(this.secrets, deepgramPrompt);
		this.cleanup = new TauriCleanupService(this.secrets, this.notifier);
	}

	/** Requests permissions and loads persisted state. Call once at startup. */
	async init(): Promise<void> {
		// Don't block startup (and hotkey registration in main.ts) on the
		// notification-permission dialog: it's best-effort per the Notifier
		// contract, and on this menu-bar (Accessory-policy) app the system
		// dialog isn't reliably raised to the front, so awaiting it can hang
		// indefinitely with no visible sign anything is wrong.
		void this.notifier.init();
		await this.store.init();
	}

	/**
	 * Invoked by the global hotkey. First press starts capture; second press
	 * stops it, transcribes, and shows the transcript.
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
			await invoke('start_capture');
			this.recording = true;
			setPhase('Recording… press the hotkey again to stop.');
			this.notifier.info('Verba: recording…');
		} catch (err) {
			this.notifier.error(`Verba: could not start recording — ${errText(err)}`);
		}
	}

	private async stopAndTranscribe(): Promise<void> {
		this.working = true;
		this.recording = false;
		try {
			const wavPath = await invoke<string>('stop_capture');
			setPhase('Transcribing…');
			const { text } = await this.deepgram.transcribe(wavPath);

			const hasAccessibility = await invoke<boolean>('has_accessibility_permission');
			if (!hasAccessibility) {
				await showAccessibilityOnboarding(() => {
					void invoke('open_accessibility_settings');
				});
			}
			await showTranscript(text);
		} catch (err) {
			this.notifier.error(`Verba: ${errText(err)}`);
			setPhase('Idle.');
		} finally {
			this.working = false;
		}
	}
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
