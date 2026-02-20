import * as assert from 'assert';
import * as sinon from 'sinon';

import { selectTemplate, Template } from '../../templatePicker';

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
		assert.strictEqual(options.activeItems[0].label, 'Commit Message');
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
});
