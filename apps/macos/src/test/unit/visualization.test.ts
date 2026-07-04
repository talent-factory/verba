import * as assert from 'assert';
import * as sinon from 'sinon';

import { createVisualization } from '../../visualization/visualization';

suite('createVisualization', () => {
	test('setState invokes both tray and hud commands with mapped values', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).setState('recording');

		const tray = invoke.getCalls().find((c) => c.args[0] === 'set_tray_state');
		const hud = invoke.getCalls().find((c) => c.args[0] === 'set_hud_state');
		assert.ok(tray, 'set_tray_state called');
		assert.ok(hud, 'set_hud_state called');
		assert.deepStrictEqual(tray!.args[1], { state: 'recording', tooltip: 'Verba — Aufnahme', title: '●' });
		assert.deepStrictEqual(hud!.args[1], { state: 'recording', label: 'Aufnahme …', icon: '🎙', accent: '#e5484d' });
	});

	test('setState for idle still calls set_hud_state (so the HUD hides)', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).setState('idle');
		assert.ok(invoke.getCalls().some((c) => c.args[0] === 'set_hud_state' && c.args[1].state === 'idle'));
	});

	test('is best-effort: a rejecting invoke does not throw', () => {
		const invoke = sinon.stub().rejects(new Error('ipc down'));
		assert.doesNotThrow(() => createVisualization(invoke).setState('processing'));
	});
});
