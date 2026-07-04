import * as assert from 'assert';
import * as sinon from 'sinon';

import { loadConfig, resolveActiveTemplate, DEFAULT_TEMPLATES } from '../../config/verbaConfig';

suite('loadConfig', () => {
	test('returns all defaults when the file is missing (empty object)', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		assert.strictEqual(cfg.transcriptionLanguage, 'multi');
		assert.strictEqual(cfg.language, 'auto');
		assert.deepStrictEqual(cfg.glossary, []);
		assert.deepStrictEqual(cfg.expansions, []);
	});

	test('returns all defaults (no throw) on malformed JSON', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{ not valid json'));
		assert.strictEqual(cfg.transcriptionLanguage, 'multi');
		assert.strictEqual(cfg.language, 'auto');
		assert.deepStrictEqual(cfg.glossary, []);
		assert.deepStrictEqual(cfg.expansions, []);
	});

	test('parses populated values through', async () => {
		const raw = JSON.stringify({
			transcription: { language: 'de' },
			language: 'de',
			glossary: ['Verba', 'Deepgram'],
			expansions: [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }],
		});
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.transcriptionLanguage, 'de');
		assert.strictEqual(cfg.language, 'de');
		assert.deepStrictEqual(cfg.glossary, ['Verba', 'Deepgram']);
		assert.deepStrictEqual(cfg.expansions, [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }]);
	});

	test('coerces wrong-typed fields to defaults', async () => {
		const raw = JSON.stringify({ glossary: 'nope', expansions: 5, transcription: { language: 42 } });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.deepStrictEqual(cfg.glossary, []);
		assert.deepStrictEqual(cfg.expansions, []);
		assert.strictEqual(cfg.transcriptionLanguage, 'multi');
	});

	test('applies defaults for fields absent from a partial config', async () => {
		const cfg = await loadConfig(sinon.stub().resolves(JSON.stringify({ transcription: { language: 'en' } })));
		assert.strictEqual(cfg.transcriptionLanguage, 'en');
		assert.strictEqual(cfg.language, 'auto');
		assert.deepStrictEqual(cfg.glossary, []);
	});
});

suite('templates', () => {
	test('defaults to the 9 bundled templates when config has none', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		assert.strictEqual(cfg.templates.length, 9);
		assert.strictEqual(cfg.templates[0].name, 'Freitext');
		assert.strictEqual(cfg.activeTemplate.name, 'Freitext');
	});

	test('a valid templates array replaces the defaults', async () => {
		const raw = JSON.stringify({
			templates: [{ name: 'Custom', prompt: 'do the thing' }],
		});
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 1);
		assert.strictEqual(cfg.templates[0].name, 'Custom');
		assert.strictEqual(cfg.activeTemplate.name, 'Custom');
	});

	test('activeTemplate selects the named template', async () => {
		const raw = JSON.stringify({ activeTemplate: 'E-Mail' });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.activeTemplate.name, 'E-Mail');
	});

	test('activeTemplate naming a missing template falls back to the first', async () => {
		const raw = JSON.stringify({ activeTemplate: 'Nonexistent' });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.activeTemplate.name, 'Freitext');
	});

	test('malformed templates fall back to the defaults', async () => {
		const raw = JSON.stringify({ templates: [{ name: 'NoPrompt' }, 'nope'] });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 9);
	});

	test('resolveActiveTemplate returns the first template when name is undefined', () => {
		const t = resolveActiveTemplate(DEFAULT_TEMPLATES, undefined);
		assert.strictEqual(t.name, 'Freitext');
	});
});
