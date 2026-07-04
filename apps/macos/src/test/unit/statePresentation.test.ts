import * as assert from 'assert';

import { presentationFor } from '../../visualization/statePresentation';

suite('presentationFor', () => {
	test('idle → HUD hidden, idle tooltip, empty title', () => {
		const p = presentationFor('idle');
		assert.strictEqual(p.hudVisible, false);
		assert.strictEqual(p.trayTooltip, 'Verba — bereit');
		assert.strictEqual(p.trayTitle, '');
	});

	test('recording → HUD visible, red accent, mic icon', () => {
		const p = presentationFor('recording');
		assert.strictEqual(p.hudVisible, true);
		assert.strictEqual(p.hudIcon, '🎙');
		assert.strictEqual(p.hudLabel, 'Aufnahme …');
		assert.strictEqual(p.hudAccent, '#e5484d');
		assert.strictEqual(p.trayTooltip, 'Verba — Aufnahme');
		assert.strictEqual(p.trayTitle, '●');
	});

	test('transcribing → amber accent, record icon', () => {
		const p = presentationFor('transcribing');
		assert.strictEqual(p.hudVisible, true);
		assert.strictEqual(p.hudIcon, '⏺');
		assert.strictEqual(p.hudLabel, 'Transkribiere …');
		assert.strictEqual(p.hudAccent, '#f5a623');
		assert.strictEqual(p.trayTooltip, 'Verba — Transkribiere');
		assert.strictEqual(p.trayTitle, '…');
	});

	test('processing → blue accent, gear icon', () => {
		const p = presentationFor('processing');
		assert.strictEqual(p.hudVisible, true);
		assert.strictEqual(p.hudIcon, '⚙');
		assert.strictEqual(p.hudLabel, 'Verarbeite mit Claude …');
		assert.strictEqual(p.hudAccent, '#3b82f6');
		assert.strictEqual(p.trayTooltip, 'Verba — Verarbeite');
		assert.strictEqual(p.trayTitle, '…');
	});
});
