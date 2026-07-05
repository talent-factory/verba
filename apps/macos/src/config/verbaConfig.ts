import { invoke } from '@tauri-apps/api/core';
import type { Expansion, PipelineContext } from '@verba/core';

import defaultTemplatesData from './defaultTemplates.json';

/** A post-processing template: the Claude system prompt plus tray display metadata. */
export interface Template {
	name: string;
	prompt: string;
	icon?: string;
	contextAware?: boolean;
}

/** The bundled default templates (single source, shared with the Rust tray). */
export const DEFAULT_TEMPLATES: Template[] = defaultTemplatesData as Template[];

/** Raw parsed shape of `~/.config/verba/config.json` — every field optional. */
export interface VerbaConfig {
	transcription?: { language?: string; provider?: string; localModel?: string };
	language?: string;
	glossary?: string[];
	expansions?: Expansion[];
	templates?: unknown[];
	activeTemplate?: string;
	audioDevice?: string;
}

/** Config with every wired field resolved to a concrete, typed value. */
export interface ResolvedConfig {
	transcriptionLanguage: string;
	language: string;
	glossary: string[];
	expansions: Expansion[];
	templates: Template[];
	activeTemplate: Template;
}

/** Reads the raw config file contents; defaults to the Tauri `read_config` command. */
export type ReadConfig = () => Promise<string>;

const DEFAULTS: ResolvedConfig = {
	transcriptionLanguage: 'multi',
	language: 'auto',
	glossary: [],
	expansions: [],
	templates: DEFAULT_TEMPLATES,
	activeTemplate: DEFAULT_TEMPLATES[0],
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
 * Reads and resolves the user config. Never throws: a missing, unreadable, or
 * malformed file — or any wrong-typed field — falls back to {@link DEFAULTS}.
 *
 * `onMalformed` fires only when the file content is present but not valid JSON
 * (an absent/unreadable file resolves to `"{}"` and parses cleanly). Callers use
 * it to tell the user their hand-edited config was ignored — otherwise the reset
 * to defaults is a silent surprise. The tray menu invites editing, so a syntax
 * error is a real, recoverable user mistake worth surfacing.
 */
export async function loadConfig(
	readConfig: ReadConfig = invokeReadConfig,
	onMalformed?: (err: unknown) => void,
): Promise<ResolvedConfig> {
	let raw: VerbaConfig = {};
	try {
		const parsed: unknown = JSON.parse(await readConfig());
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			raw = parsed as VerbaConfig;
		}
	} catch (err) {
		console.warn('[Verba] Could not read/parse config; using defaults:', err);
		onMalformed?.(err);
	}

	return {
		transcriptionLanguage: nonEmptyString(raw.transcription?.language)
			? raw.transcription!.language!
			: DEFAULTS.transcriptionLanguage,
		language: nonEmptyString(raw.language) ? raw.language : DEFAULTS.language,
		glossary: isStringArray(raw.glossary) ? raw.glossary : DEFAULTS.glossary,
		expansions: isExpansionArray(raw.expansions) ? raw.expansions : DEFAULTS.expansions,
		templates: isTemplateArray(raw.templates) ? raw.templates : DEFAULT_TEMPLATES,
		activeTemplate: resolveActiveTemplate(
			isTemplateArray(raw.templates) ? raw.templates : DEFAULT_TEMPLATES,
			raw.activeTemplate,
		),
	};
}

/** The mutable sinks a resolved config is applied to at runtime. */
export interface ApplyTargets {
	setLanguage(language: string): void;
	setGlossary(terms: string[]): void;
	setExpansions(expansions: Expansion[]): void;
}

/** Applies the wired config values to the running provider/cleanup. */
export function applyConfig(config: ResolvedConfig, targets: ApplyTargets): void {
	targets.setLanguage(config.transcriptionLanguage);
	targets.setGlossary(config.glossary);
	targets.setExpansions(config.expansions);
}

/**
 * Builds the pipeline context for a dictation: injects the active template's
 * prompt, and pins the cleanup language when the user chose a fixed one
 * (otherwise the transcription-detected language on `context` is kept).
 */
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext {
	const merged: PipelineContext = { ...context, templatePrompt: config.activeTemplate.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	return merged;
}
