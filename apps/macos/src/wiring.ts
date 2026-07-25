import { CleanupService, DEFAULT_ACTIVATION, type ApiKeyPrompt, type DetectedSurface, type SurfaceClass } from '@verba/core';
import { invoke } from '@tauri-apps/api/core';
import { TauriSecretStore } from './adapters/secretStore';
import { EnvAwareSecretStore } from './adapters/envAwareSecretStore';
import { TauriKeyValueStore } from './adapters/keyValueStore';
import { TauriNotifier } from './adapters/notifier';
import { DeepgramTauriProvider } from './deepgramTauriProvider';
import { createAnthropicTauriFetch } from './adapters/anthropicTauriFetch';
import { promptForApiKey, setPhase, showAccessibilityOnboarding, showTranscript } from './ui';
import { DictationController } from './controller';
import type { DeliveryPorts } from './delivery';
import { loadConfig, applyConfig, cleanupContextFor, templateForSurface } from './config/verbaConfig';
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
	activationMode: () => 'push-to-talk' | 'toggle';
}> {
	const notifier = new TauriNotifier();
	// A hand-edited config with a JSON syntax error silently resets every setting
	// to defaults; on a menu-bar (Accessory) app console warnings are invisible,
	// so surface it as a notification the user can actually see and act on.
	const notifyMalformedConfig = (): void =>
		notifier.warn('Verba: config.json has a syntax error and was ignored — using defaults. Fix it via the tray menu.');

	const configState = { current: await loadConfig(undefined, notifyMalformedConfig) };

	// `activation.insertKey`/`submitKey` are resolved and validated here, but
	// `activation.rs` still hardcodes right-Command/right-Option regardless of
	// their value — remapping isn't wired to the event tap yet. Without this a
	// user who sets a custom key gets a silent no-op; warn once at startup so
	// it's visible instead. Gated on non-default so the common case stays quiet.
	const { insertKey, submitKey } = configState.current.activation;
	if (insertKey !== DEFAULT_ACTIVATION.insertKey || submitKey !== DEFAULT_ACTIVATION.submitKey) {
		notifier.warn('Verba: custom Push-to-Talk keys are not supported yet — using right-Command / right-Option.');
	}

	const secrets = new EnvAwareSecretStore(new TauriSecretStore());
	const deepgramPrompt: ApiKeyPrompt = () => promptForApiKey('Deepgram API key (dg-…)');

	// NOTE: `transcription.provider` from the config only drives the tray
	// checkmark today — the provider is always Deepgram until local transcription
	// is wired (the "Lokal" tray entry is disabled). See menu.rs PROVIDERS.
	const provider = new DeepgramTauriProvider(secrets, deepgramPrompt, invoke, configState.current.transcriptionLanguage);

	// Route the Anthropic SDK's HTTP through the Rust `anthropic_fetch` command
	// instead of the WebView's `fetch`: from the production build's `tauri://`
	// origin a `fetch` to api.anthropic.com never completes and freezes cleanup
	// (it works under `macos-dev` on http://localhost). The native path has no
	// origin and its own timeout — see anthropicTauriFetch.ts for details.
	const cleanup = new TauriCleanupService(secrets, notifier, {
		dangerouslyAllowBrowser: true,
		fetch: createAnthropicTauriFetch(invoke),
	});
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

	// Delivery routing: a focused herdr agent pane receives text natively (and an
	// Enter on `submit`); every other surface falls back to the ⌘V paste path.
	const delivery: DeliveryPorts = {
		detectSurface: () => {
			const cfg = configState.current;
			return invoke<DetectedSurface>('detect_surface', {
				agentMarkers: cfg.agentMarkers,
				terminalApps: cfg.terminalApps,
				editorApps: cfg.editorApps,
			});
		},
		herdrSend: (paneId, text, submit) => invoke<'delivered' | 'delivered-not-submitted'>('herdr_send', { paneId, text, submit }),
		paste: (text) => invoke<'pasted' | 'secure-input'>('paste_text', { text }),
		pressEnter: () => invoke<void>('press_enter'),
		hasAccessibility: () => invoke<boolean>('has_accessibility_permission'),
	};

	const controller = new DictationController({
		deepgram: { transcribe: (audioPath) => provider.transcribe(audioPath, configState.current.glossary) },
		cleanup: {
			// Forward the AbortSignal to core so an abort *before* the request is
			// dispatched is honored and the SDK won't start a retry. The native
			// Rust fetch can't be cancelled mid-flight (see anthropicTauriFetch.ts),
			// so a request already in flight runs to its 30s timeout — the
			// controller's `withCleanupTimeout` bounds the user-visible wait.
			process: async (transcript, context, signal) => {
				const cfg = configState.current;
				let surfaceClass: SurfaceClass = 'generic';
				try {
					const surface = await invoke<DetectedSurface>('detect_surface', {
						agentMarkers: cfg.agentMarkers,
						terminalApps: cfg.terminalApps,
						editorApps: cfg.editorApps,
					});
					surfaceClass = surface.class;
				} catch (err) {
					console.warn('[Verba] surface detection failed, using active template:', err);
				}
				const template = templateForSurface(cfg, surfaceClass);
				return cleanup.process(transcript, cleanupContextFor(cfg, context, template), signal);
			},
		},
		notifier,
		store: new TauriKeyValueStore(),
		invoke,
		delivery,
		holdThresholdMs: configState.current.activation.holdThresholdMs,
		ui: { setPhase, showTranscript, showAccessibilityOnboarding, setState: visualization.setState, showMessage: visualization.showMessage },
	});

	return { controller, reloadConfig, notifier, activationMode: () => configState.current.activation.mode };
}
