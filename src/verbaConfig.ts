import * as vscode from 'vscode';
import { resolveConfig, type ConfigProvider, type ResolvedConfig } from '@verba/core';

/** Reads `verba.*` settings through VS Code; satisfies core's per-key ConfigProvider. */
class VsCodeConfigProvider implements ConfigProvider {
	get<T>(key: string, defaultValue: T): T {
		return vscode.workspace.getConfiguration('verba').get<T>(key, defaultValue);
	}
}

/** Resolves the shared Verba config from VS Code settings via @verba/core. Fresh each call. */
export function resolvedVerbaConfig(): ResolvedConfig {
	return resolveConfig(new VsCodeConfigProvider());
}

/**
 * The user's explicit `verba.transcription.language`, or `undefined` if unset.
 * Backward-compatible override: when set it drives the transcription language;
 * otherwise the caller falls back to the legacy `verba.language` behavior.
 */
export function transcriptionLanguageOverride(): string | undefined {
	// Intentionally uses this `inspect()`-based override rather than
	// `resolvedVerbaConfig().transcriptionLanguage`: only `inspect()` can
	// distinguish "unset" from "explicitly set to 'multi'", which the
	// legacy `verba.language` fallback logic depends on.
	const insp = vscode.workspace.getConfiguration('verba').inspect<string>('transcription.language');
	return insp?.workspaceFolderValue ?? insp?.workspaceValue ?? insp?.globalValue;
}

/** Maps an explicit `verba.transcription.language` override to this host's transcription value ('multi' is expressed as 'auto'). */
export function overrideTranscriptionLanguage(override: string): string {
	return override === 'multi' ? 'auto' : override;
}
