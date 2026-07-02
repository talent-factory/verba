import { CleanupService, DeepgramProvider, type AudioBytesReader, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { promptForApiKey, setPhase, showTranscript } from './ui';

/** CleanupService needs a host prompt for its API key; supply it via the window UI. */
class TauriCleanupService extends CleanupService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return promptForApiKey('Anthropic API key (sk-ant-…)');
	}
}

/**
 * Wires `@verba/core` to the macOS host adapters and owns the dictation flow.
 *
 * **M2 (this milestone):** the hotkey toggles microphone capture; on stop, the
 * recording is transcribed with {@link DeepgramProvider} and the transcript is
 * shown in the window. Keychain-backed secrets; a window prompt for API keys.
 *
 * **M3 (next):** run {@link CleanupService} on the transcript and paste the
 * result into the frontmost app instead of just displaying it.
 */
export class DictationController {
	private readonly secrets = new TauriSecretStore();
	private readonly store = new TauriKeyValueStore();
	private readonly notifier = new TauriNotifier();
	private readonly deepgram: DeepgramProvider;
	private readonly cleanup: CleanupService;
	private recording = false;
	private working = false;

	constructor() {
		// Audio bytes are read by Rust (`read_audio_file`); injecting the reader
		// keeps the core free of any filesystem dependency.
		const readAudio: AudioBytesReader = async (source) => {
			const bytes = await invoke<number[]>('read_audio_file', { path: source });
			return new Uint8Array(bytes);
		};
		const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

		this.deepgram = new DeepgramProvider(this.secrets, readAudio, deepgramPrompt);
		this.cleanup = new TauriCleanupService(this.secrets, this.notifier);
	}

	/** Requests permissions and loads persisted state. Call once at startup. */
	async init(): Promise<void> {
		await this.notifier.init();
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
