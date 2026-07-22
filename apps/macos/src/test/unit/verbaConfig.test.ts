import * as assert from 'assert';
import * as sinon from 'sinon';

import {
	loadConfig,
	resolveActiveTemplate,
	DEFAULT_TEMPLATES,
	cleanupContextFor,
	ObjectConfigProvider,
} from '../../config/verbaConfig';
import type { ResolvedConfig, Template } from '@verba/core';

suite('cleanupContextFor outputLanguage', () => {
	function baseConfig(activeTemplate: Template): ResolvedConfig {
		return {
			language: 'auto',
			transcriptionLanguage: 'multi',
			provider: 'deepgram',
			localModel: 'base',
			glossary: [],
			expansions: [],
			templates: [activeTemplate],
			activeTemplate,
			agentMarkers: [],
			terminalApps: [],
			editorApps: [],
		};
	}

	test('passes the active template outputLanguage into the context', () => {
		const cfg = baseConfig({ name: 'Agent Instruction', prompt: 'p', outputLanguage: 'en' });
		const ctx = cleanupContextFor(cfg);
		assert.strictEqual(ctx.outputLanguage, 'en');
		assert.strictEqual(ctx.templatePrompt, 'p');
	});

	test('leaves outputLanguage undefined when the template has none', () => {
		const cfg = baseConfig({ name: 'Freitext', prompt: 'p' });
		const ctx = cleanupContextFor(cfg);
		assert.strictEqual(ctx.outputLanguage, undefined);
	});
});

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
		assert.strictEqual(cfg.templates.length, 10);
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
		assert.strictEqual(cfg.templates.length, 10);
	});

	// Parity with the Rust `template_choices_from_value` tests in config.rs: the
	// all-or-nothing validity must behave identically on both sides.

	test('a whitespace-only template name falls back to the defaults', async () => {
		const raw = JSON.stringify({ templates: [{ name: '   ', prompt: 'x' }] });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 10);
		assert.strictEqual(cfg.templates[0].name, 'Freitext');
	});

	test('a single invalid entry invalidates the whole array (all-or-nothing)', async () => {
		const raw = JSON.stringify({
			templates: [{ prompt: 'no name' }, { name: 'Ok', prompt: 'y' }],
		});
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 10);
		assert.strictEqual(cfg.templates[0].name, 'Freitext');
	});

	test('an empty templates array falls back to the defaults', async () => {
		const raw = JSON.stringify({ templates: [] });
		const cfg = await loadConfig(sinon.stub().resolves(raw));
		assert.strictEqual(cfg.templates.length, 10);
	});

	test('resolveActiveTemplate returns the first template when name is undefined', () => {
		const t = resolveActiveTemplate(DEFAULT_TEMPLATES, undefined);
		assert.strictEqual(t.name, 'Freitext');
	});
});

suite('loadConfig onMalformed', () => {
	test('fires the callback when the file content is not valid JSON', async () => {
		const onMalformed = sinon.stub();
		await loadConfig(sinon.stub().resolves('{ not valid json'), onMalformed);
		assert.strictEqual(onMalformed.calledOnce, true);
	});

	test('does not fire for an absent (empty-object) or valid config', async () => {
		const onMalformed = sinon.stub();
		await loadConfig(sinon.stub().resolves('{}'), onMalformed);
		await loadConfig(sinon.stub().resolves(JSON.stringify({ language: 'de' })), onMalformed);
		assert.strictEqual(onMalformed.called, false);
	});
});

suite('cleanupContextFor', () => {
	test('sets templatePrompt from the active template', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		const ctx = cleanupContextFor(cfg, { detectedLanguage: 'de' });
		assert.strictEqual(ctx.templatePrompt, DEFAULT_TEMPLATES[0].prompt);
		// language 'auto' → keep the transcription-detected language
		assert.strictEqual(ctx.detectedLanguage, 'de');
	});

	test('overrides detectedLanguage when config language is not auto', async () => {
		const cfg = await loadConfig(sinon.stub().resolves(JSON.stringify({ language: 'en' })));
		const ctx = cleanupContextFor(cfg, { detectedLanguage: 'de' });
		assert.strictEqual(ctx.detectedLanguage, 'en');
	});

	test('works with no incoming context', async () => {
		const cfg = await loadConfig(sinon.stub().resolves('{}'));
		const ctx = cleanupContextFor(cfg, undefined);
		assert.strictEqual(ctx.templatePrompt, DEFAULT_TEMPLATES[0].prompt);
	});
});

suite('ObjectConfigProvider', () => {
	test('resolves flat, nested, missing and non-object keys', () => {
		const p = new ObjectConfigProvider({ language: 'de', transcription: { language: 'multi' } });
		assert.strictEqual(p.get('language', 'auto'), 'de');
		assert.strictEqual(p.get('transcription.language', 'x'), 'multi');
		assert.strictEqual(p.get('transcription.provider', 'deepgram'), 'deepgram');
		assert.strictEqual(p.get('nope.deep', 'fallback'), 'fallback');
	});
});
