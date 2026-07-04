import { invoke } from '@tauri-apps/api/core';
import type { Expansion } from '@verba/core';

/** Raw parsed shape of `~/.config/verba/config.json` — every field optional. */
export interface VerbaConfig {
	transcription?: { language?: string; provider?: string; localModel?: string };
	language?: string;
	glossary?: string[];
	expansions?: Expansion[];
	templates?: unknown[];
	autoSelectTemplate?: boolean;
	audioDevice?: string;
}

/** Config with every wired field resolved to a concrete, typed value. */
export interface ResolvedConfig {
	transcriptionLanguage: string;
	language: string;
	glossary: string[];
	expansions: Expansion[];
}

/** Reads the raw config file contents; defaults to the Tauri `read_config` command. */
export type ReadConfig = () => Promise<string>;

const DEFAULTS: ResolvedConfig = {
	transcriptionLanguage: 'multi',
	language: 'auto',
	glossary: [],
	expansions: [],
};

const invokeReadConfig: ReadConfig = () => invoke<string>('read_config');

function nonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isExpansionArray(v: unknown): v is Expansion[] {
	return Array.isArray(v) && v.every(
		(x) => !!x && typeof x === 'object'
			&& typeof (x as Expansion).abbreviation === 'string'
			&& typeof (x as Expansion).expansion === 'string',
	);
}

/**
 * Reads and resolves the user config. Never throws: a missing, unreadable, or
 * malformed file — or any wrong-typed field — falls back to {@link DEFAULTS}.
 */
export async function loadConfig(readConfig: ReadConfig = invokeReadConfig): Promise<ResolvedConfig> {
	let raw: VerbaConfig = {};
	try {
		const parsed: unknown = JSON.parse(await readConfig());
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			raw = parsed as VerbaConfig;
		}
	} catch (err) {
		console.warn('[Verba] Could not read/parse config; using defaults:', err);
	}

	return {
		transcriptionLanguage: nonEmptyString(raw.transcription?.language)
			? raw.transcription!.language!
			: DEFAULTS.transcriptionLanguage,
		language: nonEmptyString(raw.language) ? raw.language : DEFAULTS.language,
		glossary: isStringArray(raw.glossary) ? raw.glossary : DEFAULTS.glossary,
		expansions: isExpansionArray(raw.expansions) ? raw.expansions : DEFAULTS.expansions,
	};
}
