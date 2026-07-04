import { CleanupService, type ApiKeyPrompt } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { EnvAwareSecretStore } from './adapters/envAwareSecretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { DeepgramTauriProvider } from './deepgramTauriProvider';
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';
import { DictationController } from './controller';

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
export function createDictationController(): DictationController {
	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
	const notifier = new TauriNotifier();
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	return new DictationController({
		deepgram: new DeepgramTauriProvider(secrets, deepgramPrompt),
		// dangerouslyAllowBrowser: the Anthropic SDK refuses browser-like
		// environments (Tauri's WebView) by default; Anthropic officially
		// supports direct browser access via CORS when this flag is set.
		cleanup: new TauriCleanupService(secrets, notifier, { dangerouslyAllowBrowser: true }),
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding },
	});
}
