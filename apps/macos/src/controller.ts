import { CleanupService, DeepgramProvider, type AudioBytesReader, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';

/**
 * Wires `@verba/core` to the macOS host adapters and owns the dictation flow.
 *
 * **M1 (this skeleton):** proves the hotkey path with a toast, and demonstrates
 * that the core services are constructible from Tauri adapters (compile-time
 * proof that the seams line up).
 *
 * **M2/M3 (next):** the hotkey will start audio capture, run
 * {@link DeepgramProvider.transcribe} → {@link CleanupService.process}, then
 * paste the result into the frontmost app.
 */
export class DictationController {
	private readonly secrets = new TauriSecretStore();
	private readonly store = new TauriKeyValueStore();
	private readonly notifier = new TauriNotifier();
	private readonly deepgram: DeepgramProvider;
	private readonly cleanup: CleanupService;
	private busy = false;

	constructor() {
		// Audio bytes come from a Rust command (implemented in M2). Injecting the
		// reader keeps the core free of any filesystem dependency.
		const readAudio: AudioBytesReader = async (source) => {
			const bytes = await invoke<number[]>('read_audio_file', { path: source });
			return new Uint8Array(bytes);
		};
		// M2 will present a real key-entry window; the skeleton has no prompt.
		const promptForApiKey: ApiKeyPrompt = async () => undefined;

		this.deepgram = new DeepgramProvider(this.secrets, readAudio, promptForApiKey);
		this.cleanup = new CleanupService(this.secrets, this.notifier);
	}

	/** Requests permissions and loads persisted state. Call once at startup. */
	async init(): Promise<void> {
		await this.notifier.init();
		await this.store.init();
	}

	/**
	 * Invoked by the global hotkey. M1 shows a confirmation toast; the full
	 * capture → transcribe → cleanup → paste pipeline lands in M2/M3.
	 */
	async handleHotkey(): Promise<void> {
		if (this.busy) { return; }
		this.busy = true;
		try {
			this.notifier.info('Verba: hotkey received — dictation pipeline arrives in M2.');
			// M2/M3 outline (kept as a reference; not yet active):
			//   const wavPath = await invoke<string>('start_capture');
			//   … stop on next press …
			//   const { text } = await this.deepgram.transcribe(wavPath, glossary);
			//   const cleaned = await this.cleanup.process(text, { templatePrompt });
			//   await invoke('paste_text', { text: cleaned });
		} finally {
			this.busy = false;
		}
	}
}
