import * as assert from 'assert';
import * as sinon from 'sinon';

import { loadConfig } from '../../config/verbaConfig';

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
