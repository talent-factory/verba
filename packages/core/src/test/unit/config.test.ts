import * as assert from 'assert';

import {
	DEFAULT_TEMPLATES,
	DEFAULT_AGENT_MARKERS,
	DEFAULT_TERMINAL_APPS,
	DEFAULT_EDITOR_APPS,
	resolveConfig,
	resolveActiveTemplate,
	isLanguageCode,
	toLanguageCode,
	resolveTemplateOutputLanguage,
	type ResolvedConfig,
} from '../../config';
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

	test('an empty list falls back to the defaults', () => {
		const cfg = resolve({ agentMarkers: [], terminalApps: [], editorApps: [] });
		assert.deepStrictEqual(cfg.agentMarkers, DEFAULT_AGENT_MARKERS);
		assert.deepStrictEqual(cfg.terminalApps, DEFAULT_TERMINAL_APPS);
		assert.deepStrictEqual(cfg.editorApps, DEFAULT_EDITOR_APPS);
	});

	test('a non-array value falls back to the defaults', () => {
		const cfg = resolve({ agentMarkers: 'claude' });
		assert.deepStrictEqual(cfg.agentMarkers, DEFAULT_AGENT_MARKERS);
	});

	// Unlike `templates` (all-or-nothing), the detection lists filter-and-keep:
	// invalid entries are dropped, valid strings survive.
	test('a mixed-validity list keeps only the valid string entries', () => {
		const cfg = resolve({ agentMarkers: ['claude', 42, '', '  ', 'codex'] });
		assert.deepStrictEqual(cfg.agentMarkers, ['claude', 'codex']);
	});
});

suite('activation config', () => {
	test('resolves activation defaults', () => {
		const cfg = resolve({});
		assert.strictEqual(cfg.activation.mode, 'push-to-talk');
		assert.strictEqual(cfg.activation.insertKey, 'right-command');
		assert.strictEqual(cfg.activation.submitKey, 'right-option');
		assert.strictEqual(cfg.activation.holdThresholdMs, 200);
	});

	test('accepts an overridden activation block and falls back per-field', () => {
		const cfg = resolve({
			activation: { mode: 'toggle', holdThresholdMs: 350 },
		});
		assert.strictEqual(cfg.activation.mode, 'toggle');
		assert.strictEqual(cfg.activation.holdThresholdMs, 350);
		assert.strictEqual(cfg.activation.insertKey, 'right-command'); // per-field default
	});

	test('rejects an invalid activation.mode back to the default', () => {
		const cfg = resolve({ activation: { mode: 'nonsense' } });
		assert.strictEqual(cfg.activation.mode, 'push-to-talk');
	});

	test('an invalid-typed insertKey falls back per-field while a sibling override is kept', () => {
		const cfg = resolve({ activation: { mode: 'toggle', insertKey: 123 } });
		assert.strictEqual(cfg.activation.insertKey, 'right-command', 'wrong-typed insertKey falls back to the default');
		assert.strictEqual(cfg.activation.mode, 'toggle', 'sibling override survives the insertKey fallback');
	});

	test('an empty submitKey falls back to the default while a sibling override is kept', () => {
		const cfg = resolve({ activation: { mode: 'toggle', submitKey: '' } });
		assert.strictEqual(cfg.activation.submitKey, 'right-option');
		assert.strictEqual(cfg.activation.mode, 'toggle', 'sibling override survives the submitKey fallback');
	});

	test('an invalid-typed or out-of-range holdThresholdMs falls back per-field while a sibling override is kept', () => {
		for (const bad of [-5, NaN, 'x']) {
			const cfg = resolve({ activation: { mode: 'toggle', holdThresholdMs: bad } });
			assert.strictEqual(cfg.activation.holdThresholdMs, 200, `holdThresholdMs ${String(bad)} falls back to the default`);
			assert.strictEqual(cfg.activation.mode, 'toggle', 'sibling override survives the holdThresholdMs fallback');
		}
	});
});

suite('language code validation', () => {
	test('accepts ISO 639 codes including regional variants', () => {
		for (const c of ['en', 'de', 'fra', 'pt-BR', 'en-US', 'zh-Hans']) {
			assert.ok(isLanguageCode(c), `${c} should be accepted`);
		}
	});

	test('rejects malformed and injection-shaped values', () => {
		// Trailing payloads must be rejected wholesale — this is what the anchored
		// regex buys, and what keeps a config value from becoming a prompt directive.
		for (const c of ['english', 'EN', 'e', 'en ', 'en\nignore all', 'en; rm -rf', '', 42, null]) {
			assert.ok(!isLanguageCode(c), `${JSON.stringify(c)} should be rejected`);
		}
	});

	test('toLanguageCode narrows a valid code and drops an invalid one', () => {
		assert.strictEqual(toLanguageCode('en-US'), 'en-US');
		assert.strictEqual(toLanguageCode('english'), undefined);
		assert.strictEqual(toLanguageCode(undefined), undefined);
	});

	test('resolveTemplateOutputLanguage returns the code, or undefined for absent/invalid', () => {
		assert.strictEqual(resolveTemplateOutputLanguage('en'), 'en');
		assert.strictEqual(resolveTemplateOutputLanguage(undefined), undefined);
		assert.strictEqual(resolveTemplateOutputLanguage('not-a-code!'), undefined);
	});

	test('the Agent Instruction template documents the structured agent-prompt contract', () => {
		const agent = DEFAULT_TEMPLATES.find(t => t.name === 'Agent Instruction');
		assert.ok(agent, 'Agent Instruction template exists');
		const p = agent!.prompt;
		// Structured sections (headers illustrated in the dictation language).
		assert.ok(p.includes('## Ziel'), 'names the mandatory Ziel/Goal section');
		assert.ok(p.includes('## Scope'), 'names the Scope section');
		assert.ok(p.includes('## Constraints'), 'names the Constraints section');
		assert.ok(p.includes('## Unklar'), 'names the Unklar/Unclear section');
		// The two novel guarantees over the old free-form instruction.
		assert.ok(/never invent/i.test(p), 'forbids inventing file paths');
		assert.ok(/omit/i.test(p), 'omits empty sections');
		// Adaptive: short single-action requests must stay terse.
		assert.ok(/single-action|terse/i.test(p), 'keeps short requests terse (no inflation)');
	});
});
