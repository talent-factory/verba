import defaultTemplatesData from './config/defaultTemplates.json';

/** A post-processing template. Union of both hosts' fields: `icon` (macOS tray) + `fileTypes` (VS Code auto-select). */
export interface Template {
	name: string;
	prompt: string;
	icon?: string;
	contextAware?: boolean;
	fileTypes?: string[];
}

/** The 9 bundled default templates — the single canonical source for both hosts. */
export const DEFAULT_TEMPLATES: Template[] = defaultTemplatesData as Template[];
