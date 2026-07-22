import defaultTemplatesData from './config/defaultTemplates.json';

import type { ConfigProvider } from './adapters';
import type { Expansion } from './cleanupService';

/** A post-processing template. Union of both hosts' fields: `icon` (macOS tray) + `fileTypes` (VS Code auto-select). */
export interface Template {
	name: string;
	prompt: string;
	icon?: string;
	contextAware?: boolean;
	fileTypes?: string[];
	/** Opt-in: force the cleanup output into this ISO 639 language (e.g. "en"),
	 *  regardless of the dictation language. Absent → follow the detected language. */
	outputLanguage?: string;
}

/** The 9 bundled default templates — the single canonical source for both hosts. */
export const DEFAULT_TEMPLATES: Template[] = defaultTemplatesData as Template[];

/** Raw on-disk/settings shape — every field optional and untrusted. */
export interface VerbaConfig {
	language?: string;
	transcription?: { language?: string; provider?: string; localModel?: string };
	glossary?: string[];
	expansions?: Expansion[];
	templates?: unknown[];
	activeTemplate?: string;
	audioDevice?: string;
}

/** Fully resolved, validated config — total for downstream consumers. */
export interface ResolvedConfig {
	language: string;
	transcriptionLanguage: string;
	provider: string;
	localModel: string;
	glossary: string[];
	expansions: Expansion[];
	templates: Template[];
	activeTemplate: Template;
	audioDevice?: string;
}

function nonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0;
}
/** Keeps only non-empty (trimmed) string entries; drops invalid entries per-element. */
function resolveStringArray(v: unknown): string[] {
	return Array.isArray(v)
		? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
		: [];
}

function isValidExpansion(x: unknown): x is Expansion {
	return !!x && typeof x === 'object'
		&& typeof (x as Expansion).abbreviation === 'string'
		&& typeof (x as Expansion).expansion === 'string';
}

/** Keeps only valid expansion entries; drops invalid entries per-element. */
function resolveExpansionArray(v: unknown): Expansion[] {
	return Array.isArray(v) ? v.filter(isValidExpansion) : [];
}
function isTemplateArray(v: unknown): v is Template[] {
	return Array.isArray(v) && v.length > 0 && v.every(
		(x) => !!x && typeof x === 'object'
			&& nonEmptyString((x as Template).name)
			&& typeof (x as Template).prompt === 'string',
	);
}

/** Returns the template named `name`, or the first template when unnamed/unknown. */
export function resolveActiveTemplate(templates: Template[], name?: string): Template {
	const found = name ? templates.find((t) => t.name === name) : undefined;
	return found ?? templates[0];
}

/**
 * Resolves the shared config from a host's raw values. Never throws: every
 * wrong-typed or absent field falls back to its default. Templates are
 * all-or-nothing (one invalid entry → the 9 bundled defaults).
 */
export function resolveConfig(provider: ConfigProvider): ResolvedConfig {
	const rawLanguage = provider.get<unknown>('language', 'auto');
	const rawTranscriptionLanguage = provider.get<unknown>('transcription.language', 'multi');
	const rawProvider = provider.get<unknown>('transcription.provider', 'deepgram');
	const rawLocalModel = provider.get<unknown>('transcription.localModel', 'base');
	const rawGlossary = provider.get<unknown>('glossary', []);
	const rawExpansions = provider.get<unknown>('expansions', []);
	const rawTemplates = provider.get<unknown>('templates', []);
	const rawActiveTemplate = provider.get<unknown>('activeTemplate', '');
	const rawAudioDevice = provider.get<unknown>('audioDevice', '');

	const templates = isTemplateArray(rawTemplates) ? rawTemplates : DEFAULT_TEMPLATES;

	return {
		language: nonEmptyString(rawLanguage) ? rawLanguage : 'auto',
		transcriptionLanguage: nonEmptyString(rawTranscriptionLanguage) ? rawTranscriptionLanguage : 'multi',
		provider: nonEmptyString(rawProvider) ? rawProvider : 'deepgram',
		localModel: nonEmptyString(rawLocalModel) ? rawLocalModel : 'base',
		glossary: resolveStringArray(rawGlossary),
		expansions: resolveExpansionArray(rawExpansions),
		templates,
		activeTemplate: resolveActiveTemplate(templates, nonEmptyString(rawActiveTemplate) ? rawActiveTemplate : undefined),
		audioDevice: nonEmptyString(rawAudioDevice) ? rawAudioDevice.trim() : undefined,
	};
}
