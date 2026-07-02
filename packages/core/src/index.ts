/**
 * `@verba/core` — platform-agnostic dictation logic.
 *
 * Public API consumed by hosts (the VS Code extension today; a Tauri macOS app
 * next). Hosts provide the adapter implementations; core never imports `vscode`,
 * `fs`, or `child_process`.
 *
 * Exports are explicit (not `export * from './x'`) because this package
 * compiles to CommonJS, and Vite (used by apps/macos) doesn't pre-bundle
 * linked npm-workspace packages the way it does regular node_modules deps —
 * it skips the CJS-named-export detection step that would otherwise resolve
 * `export *`'s `__exportStar` runtime loop, and fails with "Importing
 * binding name '...' is not found" for every named import. Explicit
 * `export { X } from './y'` compiles to a static `Object.defineProperty`
 * per name, which Vite's dev-time analysis can see. The VS Code extension
 * (plain CJS `require()`) worked fine either way; this was only ever
 * exercised by apps/macos, which had no working manual QA before now.
 */

export type {
	SecretStore,
	Notifier,
	KeyValueStore,
	AudioBytesReader,
	AudioCapture,
	TextSink,
	ConfigProvider,
} from './adapters';

export type { PipelineContext, ProcessingStage } from './pipeline';
export { DictationPipeline } from './pipeline';

export type { Expansion } from './cleanupService';
export { CleanupService } from './cleanupService';

export type { TranscriptionResult, TranscriptionBackend } from './transcription';
export { validateTranscript } from './transcription';

export type { ApiKeyPrompt } from './deepgramProvider';
export { DeepgramProvider } from './deepgramProvider';
