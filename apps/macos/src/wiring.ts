import { CleanupService, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { EnvAwareSecretStore } from './adapters/envAwareSecretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { DeepgramTauriProvider } from './deepgramTauriProvider';
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';
import { DictationController } from './controller';
import { loadConfig, applyConfig, cleanupContextFor } from './config/verbaConfig';
import { createVisualization } from './visualization/visualization';

/** CleanupService needs a host prompt for its API key; supply it via the window UI. */
class TauriCleanupService extends CleanupService {
	protected async promptForApiKey(): Promise<string | undefined> {
		return promptForApiKey('Anthropic API key (sk-ant-…)');
	}
}

/**
 * Builds the production dependency set (Tauri IPC, window UI, Keychain-backed
 * adapters) and hands it to the controller. Kept out of `controller.ts` so the
 * controller never imports the ESM-only `@tauri-apps/api` and stays testable.
 */
export async function createDictationController(): Promise<{
	controller: DictationController;
	reloadConfig: () => Promise<void>;
	notifier: TauriNotifier;
}> {
	const notifier = new TauriNotifier();
	// A hand-edited config with a JSON syntax error silently resets every setting
	// to defaults; on a menu-bar (Accessory) app console warnings are invisible,
	// so surface it as a notification the user can actually see and act on.
	const notifyMalformedConfig = (): void =>
		notifier.warn('Verba: config.json has a syntax error and was ignored — using defaults. Fix it via the tray menu.');

	const configState = { current: await loadConfig(undefined, notifyMalformedConfig) };

	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	// NOTE: `transcription.provider` from the config only drives the tray
	// checkmark today — the provider is always Deepgram until local transcription
	// is wired (the "Lokal" tray entry is disabled). See menu.rs PROVIDERS.
	const provider = new DeepgramTauriProvider(secrets, deepgramPrompt, invoke, configState.current.transcriptionLanguage);

	const cleanup = new TauriCleanupService(secrets, notifier, { dangerouslyAllowBrowser: true });
	cleanup.setGlossary(configState.current.glossary);
	cleanup.setExpansions(configState.current.expansions);

	const visualization = createVisualization(invoke);
	visualization.setState('idle');

	async function reloadConfig(): Promise<void> {
		try {
			// Reload is the most likely place to hit a malformed hand-edit, so
			// notify here too (not just at the initial load).
			configState.current = await loadConfig(undefined, notifyMalformedConfig);
			applyConfig(configState.current, {
				setLanguage: (l) => provider.setLanguage(l),
				setGlossary: (g) => cleanup.setGlossary(g),
				setExpansions: (e) => cleanup.setExpansions(e),
			});
		} catch (err) {
			console.warn('[Verba] reloadConfig failed:', err);
		}
	}

	const controller = new DictationController({
		deepgram: { transcribe: (audioPath) => provider.transcribe(audioPath, configState.current.glossary) },
		cleanup: {
			process: (transcript, context) =>
				cleanup.process(transcript, cleanupContextFor(configState.current, context)),
		},
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding, setState: visualization.setState },
	});

	return { controller, reloadConfig, notifier };
}
