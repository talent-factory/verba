import { invoke } from '@tauri-apps/api/core';
import {
	resolveConfig,
	resolveActiveTemplate,
	DEFAULT_TEMPLATES,
	type ConfigProvider,
	type Expansion,
	type PipelineContext,
	type ResolvedConfig,
	type Template,
} from '@verba/core';

export { resolveActiveTemplate, DEFAULT_TEMPLATES };
export type { ResolvedConfig, Template };

/** A `ConfigProvider` over a parsed JSON object; resolves dotted keys by walking it. */
export class ObjectConfigProvider implements ConfigProvider {
	constructor(private readonly obj: Record<string, unknown>) {}
	get<T>(key: string, def: T): T {
		let cur: unknown = this.obj;
		for (const part of key.split('.')) {
			if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
				cur = (cur as Record<string, unknown>)[part];
			} else {
				return def;
			}
		}
		return (cur === undefined ? def : (cur as T));
	}
}

/** Reads the raw config file contents; defaults to the Tauri `read_config` command. */
export type ReadConfig = () => Promise<string>;
const invokeReadConfig: ReadConfig = () => invoke<string>('read_config');

/**
 * Reads and resolves the user config via `@verba/core`. Never throws. `onMalformed`
 * fires only when the file content is present but not valid JSON (absent/unreadable
 * → `"{}"`), so callers can surface a syntax error the user can fix.
 */
export async function loadConfig(
	readConfig: ReadConfig = invokeReadConfig,
	onMalformed?: (err: unknown) => void,
): Promise<ResolvedConfig> {
	let obj: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(await readConfig());
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			obj = parsed as Record<string, unknown>;
		}
	} catch (err) {
		console.warn('[Verba] Could not read/parse config; using defaults:', err);
		onMalformed?.(err);
	}
	return resolveConfig(new ObjectConfigProvider(obj));
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
 * prompt, and pins the cleanup language when the user chose a fixed one.
 */
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext {
	const merged: PipelineContext = { ...context, templatePrompt: config.activeTemplate.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	if (config.activeTemplate.outputLanguage) {
		merged.outputLanguage = config.activeTemplate.outputLanguage;
	}
	return merged;
}
