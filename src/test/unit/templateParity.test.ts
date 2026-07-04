import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_TEMPLATES } from '@verba/core';

suite('template defaults parity (package.json ↔ @verba/core)', () => {
	test('verba.templates default deep-equals core DEFAULT_TEMPLATES', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'));
		const props = pkg.contributes.configuration.properties;
		const manifestDefault = props['verba.templates'].default;
		assert.deepStrictEqual(manifestDefault, DEFAULT_TEMPLATES);
	});
});
