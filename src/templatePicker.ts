import type { Template } from '@verba/core';
export type { Template };

interface QuickPickItem {
	label: string;
	template: Template;
}

type ShowQuickPickFn = (
	items: QuickPickItem[],
	options?: { placeHolder?: string; activeItems?: QuickPickItem[] },
) => Thenable<QuickPickItem | undefined>;

/**
 * Shows a Quick Pick menu for template selection.
 * The last-used template is pre-selected; context-aware templates are marked with a search icon.
 * @returns The selected template, or `undefined` if the user dismissed the picker.
 */
export async function selectTemplate(
	templates: Template[],
	lastUsedName: string | undefined,
	showQuickPick: ShowQuickPickFn,
): Promise<Template | undefined> {
	if (templates.length === 0) {
		throw new Error('No templates configured. Add templates in settings under verba.templates.');
	}

	const items: QuickPickItem[] = templates.map((t) => ({
		label: t.contextAware ? `$(search) ${t.name}` : t.name,
		template: t,
	}));

	const lastUsedItem = lastUsedName
		? items.find((item) => item.template.name === lastUsedName)
		: undefined;

	const options: { placeHolder: string; activeItems?: QuickPickItem[] } = {
		placeHolder: 'Select dictation template',
	};
	if (lastUsedItem) {
		options.activeItems = [lastUsedItem];
	}

	const selected = await showQuickPick(items, options);
	return selected?.template;
}

/** Returns the first template whose `fileTypes` array includes the given language ID (case-insensitive), or undefined. */
export function findTemplateForLanguage(templates: Template[], languageId: string): Template | undefined {
	const id = languageId.toLowerCase();
	return templates.find(t =>
		Array.isArray(t.fileTypes) && t.fileTypes.some(ft => typeof ft === 'string' && ft.toLowerCase() === id),
	);
}

/** The bundled template used for dictation into an AI-agent surface (e.g. a focused terminal). */
export const AGENT_INSTRUCTION_TEMPLATE_NAME = 'Agent Instruction';

/**
 * Chooses a template automatically from the dictation surface:
 * a focused terminal → the Agent Instruction template; otherwise the active
 * file's type-matched template. Returns undefined when nothing matches (the
 * caller then falls back to the last-used template or the picker).
 */
export function chooseAutoTemplate(
	templates: Template[],
	opts: { forTerminal: boolean; languageId?: string },
): Template | undefined {
	if (opts.forTerminal) {
		return templates.find(t => t.name === AGENT_INSTRUCTION_TEMPLATE_NAME);
	}
	if (opts.languageId) {
		return findTemplateForLanguage(templates, opts.languageId);
	}
	return undefined;
}
