import * as assert from 'assert';

import { DEFAULT_TEMPLATES } from '../../config';

suite('DEFAULT_TEMPLATES', () => {
	test('ships the 9 canonical templates', () => {
		assert.strictEqual(DEFAULT_TEMPLATES.length, 9);
		assert.strictEqual(DEFAULT_TEMPLATES[0].name, 'Freitext');
	});

	test('carries the union of icon (macOS) and fileTypes (VS Code)', () => {
		const freitext = DEFAULT_TEMPLATES.find((t) => t.name === 'Freitext')!;
		const javadoc = DEFAULT_TEMPLATES.find((t) => t.name === 'JavaDoc')!;
		assert.ok(freitext.icon && freitext.icon.length > 0, 'Freitext keeps its icon');
		assert.deepStrictEqual(javadoc.fileTypes, ['java', 'kotlin'], 'JavaDoc keeps fileTypes');
	});
});
