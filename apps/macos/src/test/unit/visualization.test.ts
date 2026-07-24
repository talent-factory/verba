import * as assert from 'assert';
import * as sinon from 'sinon';

import { createVisualization } from '../../visualization/visualization';
import { HUD_MESSAGES } from '../../visualization/messagePresentation';

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

	test('is best-effort: a rejecting invoke is caught and logged, not left unhandled', async () => {
		// `setState` is synchronous and fires `void invoke(...).catch(...)`, so it
		// never throws even without the `.catch`. The real guarantee is that the
		// rejection is HANDLED — assert the catch ran (logged) after the microtask
		// queue drains, which also means no unhandled rejection escaped.
		const invoke = sinon.stub().rejects(new Error('ipc down'));
		const warn = sinon.stub(console, 'warn');
		try {
			assert.doesNotThrow(() => createVisualization(invoke).setState('processing'));
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.ok(warn.called, 'the rejected invoke was caught and logged');
		} finally {
			warn.restore();
		}
	});

	test('showMessage sets the tray to idle and pushes the HUD message with mapped accent', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).showMessage(HUD_MESSAGES.secureInput);

		const tray = invoke.getCalls().find((c) => c.args[0] === 'set_tray_state');
		const msg = invoke.getCalls().find((c) => c.args[0] === 'set_hud_message');
		assert.ok(tray, 'set_tray_state called');
		assert.strictEqual(tray!.args[1].state, 'idle');
		assert.ok(msg, 'set_hud_message called');
		assert.deepStrictEqual(msg!.args[1], { label: '⌘V zum Einfügen', icon: '⚠', accent: '#f5a623' });
	});

	test('showMessage maps an error-severity message to the red accent', () => {
		const invoke = sinon.stub().resolves(undefined);
		createVisualization(invoke).showMessage(HUD_MESSAGES.noSpeech);
		const msg = invoke.getCalls().find((c) => c.args[0] === 'set_hud_message');
		assert.deepStrictEqual(msg!.args[1], { label: 'Keine Sprache erkannt', icon: '🔇', accent: '#e5484d' });
	});
});
