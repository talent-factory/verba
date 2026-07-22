import * as assert from 'assert';

import { DEFAULT_TEMPLATES, resolveConfig, resolveActiveTemplate, type ResolvedConfig } from '../../config';
import type { ConfigProvider } from '../../adapters';

suite('DEFAULT_TEMPLATES', () => {
	test('ships the 10 canonical templates', () => {
		assert.strictEqual(DEFAULT_TEMPLATES.length, 10);
		assert.strictEqual(DEFAULT_TEMPLATES[0].name, 'Freitext');
	});

	test('carries the union of icon (macOS) and fileTypes (VS Code)', () => {
		const freitext = DEFAULT_TEMPLATES.find((t) => t.name === 'Freitext')!;
		const javadoc = DEFAULT_TEMPLATES.find((t) => t.name === 'JavaDoc')!;
		assert.ok(freitext.icon && freitext.icon.length > 0, 'Freitext keeps its icon');
		assert.deepStrictEqual(javadoc.fileTypes, ['java', 'kotlin'], 'JavaDoc keeps fileTypes');
	});
});

suite('Agent Instruction template', () => {
	test('DEFAULT_TEMPLATES contains an "Agent Instruction" template', () => {
		const t = DEFAULT_TEMPLATES.find((x) => x.name === 'Agent Instruction');
		assert.ok(t, 'a template named "Agent Instruction" must exist');
	});

	test('the template is context-aware and has a non-empty prompt', () => {
		const t = DEFAULT_TEMPLATES.find((x) => x.name === 'Agent Instruction')!;
		assert.strictEqual(t.contextAware, true, 'should use code context when available');
		assert.ok(t.prompt.trim().length > 0, 'prompt must be non-empty');
	});

	test('the prompt encodes adaptive structure and terseness rules', () => {
		const t = DEFAULT_TEMPLATES.find((x) => x.name === 'Agent Instruction')!;
		// The two load-bearing behaviors from the spec: adapt to length, do not over-format.
		assert.match(t.prompt, /terse/i, 'must instruct terse output for short utterances');
		assert.match(t.prompt, /Constraints/, 'must mention the Constraints section for boundaries');
	});
});

/** In-memory ConfigProvider over a flat/nested map, resolving dotted keys. */
class FakeConfigProvider implements ConfigProvider {
	constructor(private readonly obj: Record<string, unknown>) {}
	get<T>(key: string, def: T): T {
		let cur: unknown = this.obj;
		for (const part of key.split('.')) {
			if (cur && typeof cur === 'object' && part in (cur as object)) {
				cur = (cur as Record<string, unknown>)[part];
			} else {
				return def;
			}
		}
		return (cur === undefined ? def : (cur as T));
	}
}

function resolve(obj: Record<string, unknown>): ResolvedConfig {
	return resolveConfig(new FakeConfigProvider(obj));
}

suite('resolveConfig', () => {
	test('returns all defaults for an empty config', () => {
		const c = resolve({});
		assert.strictEqual(c.language, 'auto');
		assert.strictEqual(c.transcriptionLanguage, 'multi');
		assert.strictEqual(c.provider, 'deepgram');
		assert.strictEqual(c.localModel, 'base');
		assert.deepStrictEqual(c.glossary, []);
		assert.deepStrictEqual(c.expansions, []);
		assert.strictEqual(c.templates.length, 10);
		assert.strictEqual(c.activeTemplate.name, 'Freitext');
		assert.strictEqual(c.audioDevice, undefined);
	});

	test('reads nested transcription keys and passes populated values through', () => {
		const c = resolve({
			transcription: { language: 'de', provider: 'local', localModel: 'small' },
			language: 'de',
			glossary: ['Verba'],
			expansions: [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }],
			audioDevice: '  Mic 1  ',
		});
		assert.strictEqual(c.transcriptionLanguage, 'de');
		assert.strictEqual(c.provider, 'local');
		assert.strictEqual(c.localModel, 'small');
		assert.strictEqual(c.language, 'de');
		assert.deepStrictEqual(c.glossary, ['Verba']);
		assert.deepStrictEqual(c.expansions, [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }]);
		assert.strictEqual(c.audioDevice, 'Mic 1');
	});

	test('coerces wrong-typed fields to defaults', () => {
		const c = resolve({ glossary: 'nope', expansions: 5, transcription: { language: 42 } });
		assert.deepStrictEqual(c.glossary, []);
		assert.deepStrictEqual(c.expansions, []);
		assert.strictEqual(c.transcriptionLanguage, 'multi');
	});

	test('templates: valid array replaces defaults', () => {
		const c = resolve({ templates: [{ name: 'Custom', prompt: 'do it' }] });
		assert.strictEqual(c.templates.length, 1);
		assert.strictEqual(c.activeTemplate.name, 'Custom');
	});

	test('templates: whitespace-only name → defaults (all-or-nothing)', () => {
		const c = resolve({ templates: [{ name: '   ', prompt: 'x' }] });
		assert.strictEqual(c.templates.length, 10);
	});

	test('templates: a single invalid entry invalidates the whole array', () => {
		const c = resolve({ templates: [{ prompt: 'no name' }, { name: 'Ok', prompt: 'y' }] });
		assert.strictEqual(c.templates.length, 10);
	});

	test('templates: empty array → defaults', () => {
		const c = resolve({ templates: [] });
		assert.strictEqual(c.templates.length, 10);
	});

	test('activeTemplate selects the named template, else the first', () => {
		assert.strictEqual(resolve({ activeTemplate: 'E-Mail' }).activeTemplate.name, 'E-Mail');
		assert.strictEqual(resolve({ activeTemplate: 'Nonexistent' }).activeTemplate.name, 'Freitext');
	});

	test('resolveActiveTemplate returns the first template when name is undefined', () => {
		assert.strictEqual(resolveActiveTemplate(DEFAULT_TEMPLATES, undefined).name, 'Freitext');
	});

	test('glossary: keeps valid strings, drops non-strings and whitespace-only (per-element)', () => {
		assert.deepStrictEqual(
			resolve({ glossary: ['Verba', 123, '  ', 'Deepgram', ''] }).glossary,
			['Verba', 'Deepgram'],
		);
	});

	test('glossary: a non-array falls back to []', () => {
		assert.deepStrictEqual(resolve({ glossary: 'nope' }).glossary, []);
	});

	test('expansions: keeps valid entries, drops malformed ones (per-element)', () => {
		const c = resolve({ expansions: [
			{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' },
			{ abbreviation: 'x' },   // missing expansion
			{ expansion: 'y' },      // missing abbreviation
			'nope',
		] });
		assert.deepStrictEqual(c.expansions, [{ abbreviation: 'mfg', expansion: 'mit freundlichen Grüßen' }]);
	});
});

suite('detection config', () => {
	test('resolveConfig supplies default agent markers and app lists', () => {
		const cfg = resolveConfig(new FakeConfigProvider({}));
		assert.ok(cfg.agentMarkers.includes('claude'), 'default markers include claude');
		assert.ok(cfg.agentMarkers.includes('herdr'), 'default markers include herdr');
		assert.ok(cfg.terminalApps.includes('com.googlecode.iterm2'), 'default terminals include iTerm2');
		assert.ok(cfg.editorApps.includes('com.microsoft.VSCode'), 'default editors include VS Code');
	});

	test('resolveConfig honors user-provided lists', () => {
		const cfg = resolveConfig(new FakeConfigProvider({ agentMarkers: ['xyz'] }));
		assert.deepStrictEqual(cfg.agentMarkers, ['xyz']);
	});
});
