/**
 * Platform-agnostic adapter interfaces for `@verba/core`.
 *
 * These are the "seams" that let the shared dictation logic (pipeline, cleanup,
 * transcription, prompt engineering) run on any host — the VS Code extension
 * today, and a Tauri macOS app / native iOS app in the future. Each host
 * provides concrete implementations; the core depends only on these interfaces
 * and never imports `vscode`, `fs`, or any other platform module directly.
 *
 * See docs/development/cross-platform-strategy.md (Phase 0).
 */

/**
 * Secure key/value store for secrets such as API keys.
 *
 * Structurally compatible with `vscode.SecretStorage`, so the VS Code host can
 * pass `context.secrets` directly. Other hosts back this with the OS keychain.
 */
export interface SecretStore {
	get(key: string): Thenable<string | undefined>;
	store(key: string, value: string): Thenable<void>;
	delete(key: string): Thenable<void>;
}

/**
 * Surfaces short, user-facing messages without coupling the core to a specific
 * UI toolkit. In VS Code this maps to `vscode.window.show*Message`; on other
 * hosts to a toast/notification. All methods are best-effort and must never
 * throw — the core treats notifications as non-critical side effects.
 */
export interface Notifier {
	/** Non-blocking warning (e.g. "post-processing returned an empty response"). */
	warn(message: string): void;
	/** Informational message. Optional — hosts may omit it. */
	info?(message: string): void;
	/** Error message. Optional — hosts may omit it. */
	error?(message: string): void;
}

/**
 * Reads raw audio bytes for a recorded utterance.
 *
 * On Node-based hosts (VS Code, Tauri sidecar) the `source` is a file path and
 * the default implementation is backed by `fs`. On hosts without a filesystem
 * (mobile, browser) the source may be an opaque handle resolved to bytes by the
 * host. The core only needs the resulting bytes to hand to the transcription
 * provider.
 */
export type AudioBytesReader = (source: string) => Uint8Array | Promise<Uint8Array>;

// ── Forward-looking seams (fully exercised by the platform shells) ──────────
// Defined now so the contract is stable as the macOS/iOS shells are built.

/** Captures microphone audio. Implemented per platform (ffmpeg, AVAudioEngine, getUserMedia). */
export interface AudioCapture {
	/** Starts capture and resolves with a handle/path once a recording exists. */
	start(): Promise<void>;
	/** Stops capture and resolves with the recorded audio source (path or handle). */
	stop(): Promise<string>;
	/** True while a recording is in progress. */
	readonly isRecording: boolean;
}

/** Delivers the final processed text to wherever the user is working. */
export interface TextSink {
	/** Inserts/pastes the given text into the active target (editor, terminal, frontmost app). */
	insert(text: string): Promise<void>;
}

/** Read access to user configuration (templates, glossary, language, …). */
export interface ConfigProvider {
	get<T>(key: string, defaultValue: T): T;
}
