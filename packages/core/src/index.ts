/**
 * `@verba/core` — platform-agnostic dictation logic.
 *
 * Public API consumed by hosts (the VS Code extension today; a Tauri macOS app
 * next). Hosts provide the adapter implementations; core never imports `vscode`,
 * `fs`, or `child_process`.
 */

export * from './adapters';
export * from './pipeline';
export * from './cleanupService';
export * from './transcription';
export * from './deepgramProvider';
export * from './config';
