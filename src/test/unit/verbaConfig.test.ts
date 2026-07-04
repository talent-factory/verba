import * as assert from 'assert';
import * as Module from 'module';

// --- vscode stub (registered before importing the module under test) ---
let fakeConfig: Record<string, unknown> = {};
const vscodeStub = {
	workspace: {
		getConfiguration: (_section: string) => ({
			get: (key: string, def: unknown) => (key in fakeConfig ? fakeConfig[key] : def),
			inspect: (key: string) => ({ globalValue: fakeConfig[key] }),
		}),
	},
};
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...args: unknown[]) {
	if (request === 'vscode') { return vscodeStub; }
	return originalLoad.apply(this, [request, ...args]);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolvedVerbaConfig, transcriptionLanguageOverride, overrideTranscriptionLanguage } = require('../../verbaConfig');

suite('resolvedVerbaConfig', () => {
	teardown(() => { fakeConfig = {}; });

	test('maps VS Code settings through core validation (broken template → defaults)', () => {
		fakeConfig = { templates: [{ name: 'NoPrompt' }] };
		assert.strictEqual(resolvedVerbaConfig().templates.length, 9);
	});

	test('transcriptionLanguageOverride is undefined when unset, the value when set', () => {
		fakeConfig = {};
		assert.strictEqual(transcriptionLanguageOverride(), undefined);
		fakeConfig = { 'transcription.language': 'de' };
		assert.strictEqual(transcriptionLanguageOverride(), 'de');
	});
});

suite('transcription language override semantics', () => {
	teardown(() => { fakeConfig = {}; });

	test('override maps "multi" to "auto" and passes a fixed code through', () => {
		fakeConfig = { 'transcription.language': 'multi' };
		assert.strictEqual(transcriptionLanguageOverride(), 'multi');
		fakeConfig = { 'transcription.language': 'de' };
		assert.strictEqual(transcriptionLanguageOverride(), 'de');
	});
});

suite('overrideTranscriptionLanguage', () => {
	test("maps 'multi' to 'auto' and passes fixed codes through", () => {
		assert.strictEqual(overrideTranscriptionLanguage('multi'), 'auto');
		assert.strictEqual(overrideTranscriptionLanguage('de'), 'de');
	});
});
