import { CleanupService, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { EnvAwareSecretStore } from './adapters/envAwareSecretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { DeepgramTauriProvider } from './deepgramTauriProvider';
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';
import { DictationController } from './controller';
import { loadConfig, applyConfig } from './config/verbaConfig';
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
}> {
	const configState = { current: await loadConfig() };

	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
	const notifier = new TauriNotifier();
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	const provider = new DeepgramTauriProvider(secrets, deepgramPrompt, invoke, configState.current.transcriptionLanguage);

	const cleanup = new TauriCleanupService(secrets, notifier, { dangerouslyAllowBrowser: true });
	cleanup.setGlossary(configState.current.glossary);
	cleanup.setExpansions(configState.current.expansions);

	const visualization = createVisualization(invoke);
	visualization.setState('idle');

	async function reloadConfig(): Promise<void> {
		try {
			configState.current = await loadConfig();
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
				cleanup.process(
					transcript,
					configState.current.language !== 'auto'
						? { ...context, detectedLanguage: configState.current.language }
						: context,
				),
		},
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding, setState: visualization.setState },
	});

	return { controller, reloadConfig };
}
