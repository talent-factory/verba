import * as assert from 'assert';
import { HUD_MESSAGES, accentForSeverity } from '../../visualization/messagePresentation';

suite('messagePresentation', () => {
	test('accentForSeverity maps warn to amber and error to red', () => {
		assert.strictEqual(accentForSeverity('warn'), '#f5a623');
		assert.strictEqual(accentForSeverity('error'), '#e5484d');
	});

	test('HUD_MESSAGES carries the approved copy, severity and per-message icon', () => {
		assert.deepStrictEqual(HUD_MESSAGES.secureInput, { label: '⌘V zum Einfügen', severity: 'warn', icon: '⚠' });
		assert.deepStrictEqual(HUD_MESSAGES.noSpeech, { label: 'Keine Sprache erkannt', severity: 'error', icon: '🔇' });
		assert.deepStrictEqual(HUD_MESSAGES.deliveryFailed, { label: 'Zustellung fehlgeschlagen', severity: 'error', icon: '⚠' });
	});
});
