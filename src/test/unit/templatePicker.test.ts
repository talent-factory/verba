import * as assert from 'assert';
import * as sinon from 'sinon';

import { selectTemplate, findTemplateForLanguage, chooseAutoTemplate, AGENT_INSTRUCTION_TEMPLATE_NAME, Template } from '../../templatePicker';

const DEFAULT_TEMPLATES: Template[] = [
	{ name: 'Freitext', prompt: 'Clean up the transcript.' },
	{ name: 'Commit Message', prompt: 'Convert to commit message.' },
];

suite('selectTemplate', () => {
	teardown(() => {
		sinon.restore();
	});

	test('returns selected template', async () => {
		const showQuickPick = sinon.stub().resolves({ label: 'Freitext', template: DEFAULT_TEMPLATES[0] });

		const result = await selectTemplate(DEFAULT_TEMPLATES, undefined, showQuickPick);

		assert.deepStrictEqual(result, DEFAULT_TEMPLATES[0]);
	});

	test('returns undefined when user cancels Quick-Pick', async () => {
		const showQuickPick = sinon.stub().resolves(undefined);

		const result = await selectTemplate(DEFAULT_TEMPLATES, undefined, showQuickPick);

		assert.strictEqual(result, undefined);
	});

	test('preselects last used template', async () => {
		const showQuickPick = sinon.stub().resolves({ label: 'Commit Message', template: DEFAULT_TEMPLATES[1] });

		await selectTemplate(DEFAULT_TEMPLATES, 'Commit Message', showQuickPick);

		const options = showQuickPick.firstCall.args[1];
		assert.ok(options?.activeItems, 'should set activeItems');
		assert.strictEqual(options.activeItems[0].template.name, 'Commit Message');
	});

	test('does not preselect when lastUsed does not match', async () => {
		const showQuickPick = sinon.stub().resolves({ label: 'Freitext', template: DEFAULT_TEMPLATES[0] });

		await selectTemplate(DEFAULT_TEMPLATES, 'Nonexistent', showQuickPick);

		const options = showQuickPick.firstCall.args[1];
		assert.strictEqual(options?.activeItems, undefined);
	});

	test('throws when templates array is empty', async () => {
		const showQuickPick = sinon.stub();

		await assert.rejects(
			() => selectTemplate([], undefined, showQuickPick),
			/No templates configured/
		);
		assert.ok(showQuickPick.notCalled);
	});

	test('context-aware templates show a search hint in the description', async () => {
		const templates: Template[] = [
			{ name: 'Freitext', prompt: 'Clean up.' },
			{ name: 'Code Comment', prompt: 'Generate comment.', contextAware: true },
		];
		const showQuickPick = sinon.stub().resolves({ label: 'Code Comment', template: templates[1] });

		await selectTemplate(templates, undefined, showQuickPick);

		const items = showQuickPick.firstCall.args[0];
		assert.strictEqual(items[0].label, 'Freitext');
		assert.strictEqual(items[0].description, undefined);
		assert.strictEqual(items[1].label, 'Code Comment');
		assert.strictEqual(items[1].description, '$(search) context-aware');
	});

	test('renders the template emoji icon in the label (macOS-tray parity)', async () => {
		const templates: Template[] = [
			{ name: 'Agent Instruction', prompt: 'Do it.', icon: '🦾', contextAware: true },
			{ name: 'Plain', prompt: 'Clean up.' },
		];
		const showQuickPick = sinon.stub().resolves(undefined);

		await selectTemplate(templates, undefined, showQuickPick);

		const items = showQuickPick.firstCall.args[0];
		assert.strictEqual(items[0].label, '🦾 Agent Instruction');
		assert.strictEqual(items[1].label, 'Plain');
	});

	test('flags the active (last-used) template for the check-icon gutter', async () => {
		const templates: Template[] = [
			{ name: 'Freitext', prompt: 'Clean up.', icon: '✏️' },
			{ name: 'Commit Message', prompt: 'Commit.', icon: '🔀' },
		];
		const showQuickPick = sinon.stub().resolves(undefined);

		await selectTemplate(templates, 'Commit Message', showQuickPick);

		const items = showQuickPick.firstCall.args[0];
		assert.strictEqual(items[0].label, '✏️ Freitext');
		assert.strictEqual(items[0].active, false);
		assert.strictEqual(items[1].label, '🔀 Commit Message');
		assert.strictEqual(items[1].active, true);
	});

	test('preselects context-aware template by name despite decorations in label', async () => {
		const templates: Template[] = [
			{ name: 'Code Comment', prompt: 'Generate comment.', contextAware: true },
		];
		const showQuickPick = sinon.stub().resolves({ label: '$(check) Code Comment', template: templates[0] });

		await selectTemplate(templates, 'Code Comment', showQuickPick);

		const options = showQuickPick.firstCall.args[1];
		assert.ok(options?.activeItems, 'should set activeItems for context-aware template');
		assert.strictEqual(options.activeItems[0].template.name, 'Code Comment');
	});
});

suite('findTemplateForLanguage', () => {
	const TEMPLATES_WITH_FILE_TYPES: Template[] = [
		{ name: 'Freitext', prompt: 'Clean up.' },
		{ name: 'JavaDoc', prompt: 'Generate JavaDoc.', fileTypes: ['java', 'kotlin'] },
		{ name: 'Markdown', prompt: 'Convert to Markdown.', fileTypes: ['markdown'] },
		{ name: 'Code Comment', prompt: 'Generate comment.', contextAware: true },
	];

	test('returns template matching the language ID', () => {
		const result = findTemplateForLanguage(TEMPLATES_WITH_FILE_TYPES, 'java');
		assert.strictEqual(result?.name, 'JavaDoc');
	});

	test('matches second entry in fileTypes array', () => {
		const result = findTemplateForLanguage(TEMPLATES_WITH_FILE_TYPES, 'kotlin');
		assert.strictEqual(result?.name, 'JavaDoc');
	});

	test('returns undefined when no template matches', () => {
		const result = findTemplateForLanguage(TEMPLATES_WITH_FILE_TYPES, 'python');
		assert.strictEqual(result, undefined);
	});

	test('returns undefined for templates without fileTypes', () => {
		const result = findTemplateForLanguage(TEMPLATES_WITH_FILE_TYPES, 'plaintext');
		assert.strictEqual(result, undefined);
	});

	test('returns first matching template when multiple match', () => {
		const templates: Template[] = [
			{ name: 'First', prompt: 'First.', fileTypes: ['typescript'] },
			{ name: 'Second', prompt: 'Second.', fileTypes: ['typescript'] },
		];
		const result = findTemplateForLanguage(templates, 'typescript');
		assert.strictEqual(result?.name, 'First');
	});

	test('returns undefined for empty templates array', () => {
		const result = findTemplateForLanguage([], 'java');
		assert.strictEqual(result, undefined);
	});

	test('ignores templates with non-array fileTypes', () => {
		const templates: Template[] = [
			{ name: 'Bad', prompt: 'Bad.', fileTypes: 'java' as any },
		];
		const result = findTemplateForLanguage(templates, 'java');
		assert.strictEqual(result, undefined);
	});

	test('matching is case-insensitive', () => {
		const templates: Template[] = [
			{ name: 'JavaDoc', prompt: 'JavaDoc.', fileTypes: ['Java', 'Kotlin'] },
		];
		const result = findTemplateForLanguage(templates, 'java');
		assert.strictEqual(result?.name, 'JavaDoc');
	});

	test('template with empty fileTypes array does not match any language', () => {
		const templates: Template[] = [
			{ name: 'Empty', prompt: 'Empty.', fileTypes: [] },
		];
		const result = findTemplateForLanguage(templates, 'java');
		assert.strictEqual(result, undefined);
	});
});

suite('chooseAutoTemplate', () => {
	const templates: Template[] = [
		{ name: 'Freitext', prompt: 'f' },
		{ name: 'JavaDoc', prompt: 'j', fileTypes: ['java'] },
		{ name: 'Agent Instruction', prompt: 'a' },
	];

	test('terminal dictation selects the Agent Instruction template', () => {
		const t = chooseAutoTemplate(templates, { forTerminal: true, languageId: 'java' });
		assert.strictEqual(t?.name, AGENT_INSTRUCTION_TEMPLATE_NAME);
	});

	test('terminal dictation returns undefined when no Agent Instruction template exists', () => {
		const without = templates.filter(t => t.name !== 'Agent Instruction');
		const t = chooseAutoTemplate(without, { forTerminal: true });
		assert.strictEqual(t, undefined);
	});

	test('non-terminal dictation with a matching languageId selects the file-type template', () => {
		const t = chooseAutoTemplate(templates, { forTerminal: false, languageId: 'java' });
		assert.strictEqual(t?.name, 'JavaDoc');
	});

	test('non-terminal dictation without a languageId returns undefined', () => {
		const t = chooseAutoTemplate(templates, { forTerminal: false });
		assert.strictEqual(t, undefined);
	});
});
