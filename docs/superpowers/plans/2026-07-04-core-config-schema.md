# Shared Config Schema in @verba/core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@verba/core` the single source of the shared dictation-config schema (types, defaults, validation), consumed by both the macOS Tauri app and the VS Code extension via a `ConfigProvider` adapter — so `glossary`/`expansions`/`templates` become portable and both hosts validate identically.

**Architecture:** A new pure module `packages/core/src/config.ts` defines `Template`, `VerbaConfig`, `ResolvedConfig`, `DEFAULT_TEMPLATES`, and `resolveConfig(provider: ConfigProvider): ResolvedConfig`. Each host supplies raw values through the existing per-key `ConfigProvider` interface (`get<T>(key, default): T`). Core stays stateless; reactivity stays host-side. Each host keeps its native on-disk format.

**Tech Stack:** TypeScript (strict), `@verba/core` (CommonJS, ES2022, mocha+tdd), Tauri/Rust (macOS tray reader), VS Code extension API.

## Global Constraints

- TypeScript strict mode across all packages.
- `@verba/core` compiles CommonJS/ES2022; unit tests run `dist/test/unit/**/*.test.js` via mocha (`ui: tdd`).
- Core is consumed by hosts through the workspace symlink `node_modules/@verba/core → packages/core` (runtime = `packages/core/dist`). **Core must be compiled before host builds/tests.** Root `npm run compile` already runs `compile:core` first.
- **Commits go through the project commit workflow (`/git-workflow:commit`), German, Emoji-Conventional, no `Co-Authored-By`/"Generated with" suffixes.** Each task below ends with a commit; the message is given verbatim.
- No breaking changes to either host's on-disk config format. `verba.*` keys and the macOS nested JSON stay as-is.
- `verba.transcription.language` is a **backward-compatible optional override** (see Task 8).
- Canonical templates are the **union** of both hosts' fields (`icon` + `fileTypes`); core `Template` is the superset.
- macOS test/build assumes `@verba/core` is already built. Run `npm run compile:core` from repo root before macOS `npm run test:unit` if core changed.

---

## Phase 1 — `@verba/core`: schema + resolver

### Task 1: Canonical templates + core config module scaffolding

**Files:**
- Create: `packages/core/src/config/defaultTemplates.json`
- Create: `packages/core/src/config.ts`
- Create: `packages/core/scripts/copy-assets.js`
- Create: `packages/core/src/test/unit/config.test.ts`
- Modify: `packages/core/tsconfig.json`
- Modify: `packages/core/package.json` (compile script)
- Modify: `packages/core/src/index.ts`
- Modify: `package.json` (root `compile:core` script)

**Interfaces:**
- Produces: `Template` (interface `{ name: string; prompt: string; icon?: string; contextAware?: boolean; fileTypes?: string[] }`), `DEFAULT_TEMPLATES: Template[]` (9 entries).

- [ ] **Step 1: Create the canonical union templates file**

Copy the existing macOS defaults, then add `fileTypes` to JavaDoc and Markdown (the VS Code auto-select data macOS lacks):

Run:
```bash
cp apps/macos/src/config/defaultTemplates.json packages/core/src/config/defaultTemplates.json
```

Then edit `packages/core/src/config/defaultTemplates.json`: add `"fileTypes": ["java", "kotlin"]` to the `JavaDoc` entry and `"fileTypes": ["markdown"]` to the `Markdown` entry (alongside their existing `name`/`icon`/`prompt`). Leave all other entries unchanged. This file now carries **both** `icon` (macOS tray) and `fileTypes` (VS Code auto-select) — the union.

- [ ] **Step 2: Enable JSON imports + asset copy in core build**

Modify `packages/core/tsconfig.json` `compilerOptions` — add:
```json
    "resolveJsonModule": true,
    "esModuleInterop": true,
```

Create `packages/core/scripts/copy-assets.js` (tsc does not copy `.json` into `dist/`, but the compiled `config.js` will `require('./config/defaultTemplates.json')` at runtime):
```js
// Copies non-TS assets into dist/ after tsc (tsc emits JS only).
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'config', 'defaultTemplates.json');
const destDir = path.join(__dirname, '..', 'dist', 'config');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'defaultTemplates.json'));
```

Modify `packages/core/package.json` `scripts.compile`:
```json
    "compile": "tsc -p ./ && node scripts/copy-assets.js",
```

Modify root `package.json` `scripts.compile:core` so the root build path also runs the copy (it currently calls `tsc` directly and would skip it):
```json
    "compile:core": "npm --workspace @verba/core run compile",
```

- [ ] **Step 3: Write the failing test**

Create `packages/core/src/test/unit/config.test.ts`:
```ts
import * as assert from 'assert';

import { DEFAULT_TEMPLATES } from '../../config';

suite('DEFAULT_TEMPLATES', () => {
	test('ships the 9 canonical templates', () => {
		assert.strictEqual(DEFAULT_TEMPLATES.length, 9);
		assert.strictEqual(DEFAULT_TEMPLATES[0].name, 'Freitext');
	});

	test('carries the union of icon (macOS) and fileTypes (VS Code)', () => {
		const freitext = DEFAULT_TEMPLATES.find((t) => t.name === 'Freitext')!;
		const javadoc = DEFAULT_TEMPLATES.find((t) => t.name === 'JavaDoc')!;
		assert.ok(freitext.icon && freitext.icon.length > 0, 'Freitext keeps its icon');
		assert.deepStrictEqual(javadoc.fileTypes, ['java', 'kotlin'], 'JavaDoc keeps fileTypes');
	});
});
```

- [ ] **Step 4: Create the config module**

Create `packages/core/src/config.ts`:
```ts
import defaultTemplatesData from './config/defaultTemplates.json';

/** A post-processing template. Union of both hosts' fields: `icon` (macOS tray) + `fileTypes` (VS Code auto-select). */
export interface Template {
	name: string;
	prompt: string;
	icon?: string;
	contextAware?: boolean;
	fileTypes?: string[];
}

/** The 9 bundled default templates — the single canonical source for both hosts. */
export const DEFAULT_TEMPLATES: Template[] = defaultTemplatesData as Template[];
```

Modify `packages/core/src/index.ts` — add:
```ts
export * from './config';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace @verba/core run test:unit`
Expected: PASS (both new tests green; `dist/config/defaultTemplates.json` exists post-copy).

- [ ] **Step 6: Commit**

`git add packages/core package.json` and commit via `/git-workflow:commit` with message:
```
✨ feat(core): kanonische Default-Templates + Config-Modul-Gerüst

Vereint die macOS-Icons und VS-Code-fileTypes in einer defaultTemplates.json
in @verba/core, exportiert Template + DEFAULT_TEMPLATES. tsc kopiert das
JSON per copy-assets.js nach dist (resolveJsonModule).
```

---

### Task 2: `resolveConfig` — resolution + validation

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/test/unit/config.test.ts`

**Interfaces:**
- Consumes: `ConfigProvider` (from `./adapters`: `get<T>(key: string, defaultValue: T): T`), `Expansion` (from `./cleanupService`).
- Produces:
  - `VerbaConfig` (raw, all-optional).
  - `ResolvedConfig` `{ language: string; transcriptionLanguage: string; provider: string; localModel: string; glossary: string[]; expansions: Expansion[]; templates: Template[]; activeTemplate: Template; audioDevice?: string }`.
  - `resolveConfig(provider: ConfigProvider): ResolvedConfig`.
  - `resolveActiveTemplate(templates: Template[], name?: string): Template`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/test/unit/config.test.ts`:
```ts
import { resolveConfig, resolveActiveTemplate, type ResolvedConfig } from '../../config';
import type { ConfigProvider } from '../../adapters';

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
		assert.strictEqual(c.templates.length, 9);
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
		assert.strictEqual(c.templates.length, 9);
	});

	test('templates: a single invalid entry invalidates the whole array', () => {
		const c = resolve({ templates: [{ prompt: 'no name' }, { name: 'Ok', prompt: 'y' }] });
		assert.strictEqual(c.templates.length, 9);
	});

	test('templates: empty array → defaults', () => {
		const c = resolve({ templates: [] });
		assert.strictEqual(c.templates.length, 9);
	});

	test('activeTemplate selects the named template, else the first', () => {
		assert.strictEqual(resolve({ activeTemplate: 'E-Mail' }).activeTemplate.name, 'E-Mail');
		assert.strictEqual(resolve({ activeTemplate: 'Nonexistent' }).activeTemplate.name, 'Freitext');
	});

	test('resolveActiveTemplate returns the first template when name is undefined', () => {
		assert.strictEqual(resolveActiveTemplate(DEFAULT_TEMPLATES, undefined).name, 'Freitext');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace @verba/core run test:unit`
Expected: FAIL (`resolveConfig`/`resolveActiveTemplate` not exported).

- [ ] **Step 3: Implement resolveConfig**

Append to `packages/core/src/config.ts`:
```ts
import type { ConfigProvider } from './adapters';
import type { Expansion } from './cleanupService';

/** Raw on-disk/settings shape — every field optional and untrusted. */
export interface VerbaConfig {
	language?: string;
	transcription?: { language?: string; provider?: string; localModel?: string };
	glossary?: string[];
	expansions?: Expansion[];
	templates?: unknown[];
	activeTemplate?: string;
	audioDevice?: string;
}

/** Fully resolved, validated config — total for downstream consumers. */
export interface ResolvedConfig {
	language: string;
	transcriptionLanguage: string;
	provider: string;
	localModel: string;
	glossary: string[];
	expansions: Expansion[];
	templates: Template[];
	activeTemplate: Template;
	audioDevice?: string;
}

function nonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0;
}
function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isExpansionArray(v: unknown): v is Expansion[] {
	return Array.isArray(v) && v.every(
		(x) => !!x && typeof x === 'object'
			&& typeof (x as Expansion).abbreviation === 'string'
			&& typeof (x as Expansion).expansion === 'string',
	);
}
function isTemplateArray(v: unknown): v is Template[] {
	return Array.isArray(v) && v.length > 0 && v.every(
		(x) => !!x && typeof x === 'object'
			&& nonEmptyString((x as Template).name)
			&& typeof (x as Template).prompt === 'string',
	);
}

/** Returns the template named `name`, or the first template when unnamed/unknown. */
export function resolveActiveTemplate(templates: Template[], name?: string): Template {
	const found = name ? templates.find((t) => t.name === name) : undefined;
	return found ?? templates[0];
}

/**
 * Resolves the shared config from a host's raw values. Never throws: every
 * wrong-typed or absent field falls back to its default. Templates are
 * all-or-nothing (one invalid entry → the 9 bundled defaults).
 */
export function resolveConfig(provider: ConfigProvider): ResolvedConfig {
	const rawLanguage = provider.get<unknown>('language', 'auto');
	const rawTranscriptionLanguage = provider.get<unknown>('transcription.language', 'multi');
	const rawProvider = provider.get<unknown>('transcription.provider', 'deepgram');
	const rawLocalModel = provider.get<unknown>('transcription.localModel', 'base');
	const rawGlossary = provider.get<unknown>('glossary', []);
	const rawExpansions = provider.get<unknown>('expansions', []);
	const rawTemplates = provider.get<unknown>('templates', []);
	const rawActiveTemplate = provider.get<unknown>('activeTemplate', '');
	const rawAudioDevice = provider.get<unknown>('audioDevice', '');

	const templates = isTemplateArray(rawTemplates) ? rawTemplates : DEFAULT_TEMPLATES;

	return {
		language: nonEmptyString(rawLanguage) ? rawLanguage : 'auto',
		transcriptionLanguage: nonEmptyString(rawTranscriptionLanguage) ? rawTranscriptionLanguage : 'multi',
		provider: nonEmptyString(rawProvider) ? rawProvider : 'deepgram',
		localModel: nonEmptyString(rawLocalModel) ? rawLocalModel : 'base',
		glossary: isStringArray(rawGlossary) ? rawGlossary : [],
		expansions: isExpansionArray(rawExpansions) ? rawExpansions : [],
		templates,
		activeTemplate: resolveActiveTemplate(templates, nonEmptyString(rawActiveTemplate) ? rawActiveTemplate : undefined),
		audioDevice: nonEmptyString(rawAudioDevice) ? rawAudioDevice.trim() : undefined,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @verba/core run test:unit`
Expected: PASS (all `resolveConfig` cases green).

- [ ] **Step 5: Commit**

`git add packages/core` and commit via `/git-workflow:commit`:
```
✨ feat(core): resolveConfig mit Defaults + all-or-nothing-Validierung

Reiner Resolver über das ConfigProvider-Interface: VerbaConfig →
ResolvedConfig, Per-Feld-Fallback, all-or-nothing Templates, Expansions-
Validierung, activeTemplate-Auflösung. Umfassend getestet.
```

---

## Phase 2 — macOS host

### Task 3: macOS `verbaConfig.ts` consumes core

**Files:**
- Modify: `apps/macos/src/config/verbaConfig.ts`
- Modify: `apps/macos/src/test/unit/verbaConfig.test.ts` (add ObjectConfigProvider test; existing tests stay green)

**Interfaces:**
- Consumes: `resolveConfig`, `DEFAULT_TEMPLATES`, `resolveActiveTemplate`, `Template`, `ResolvedConfig`, `Expansion` from `@verba/core`; `ConfigProvider` from `@verba/core`.
- Produces (unchanged public surface): `loadConfig`, `applyConfig`, `cleanupContextFor`, `resolveActiveTemplate` (re-export), `DEFAULT_TEMPLATES` (re-export), `ResolvedConfig`/`Template` (re-export), `ApplyTargets`.

- [ ] **Step 1: Ensure core is built (macOS resolves `@verba/core` from dist)**

Run: `npm run compile:core`
Expected: no errors; `packages/core/dist/config.js` and `dist/config/defaultTemplates.json` exist.

- [ ] **Step 2: Write the failing test**

Add to `apps/macos/src/test/unit/verbaConfig.test.ts` a new suite (keep all existing tests):
```ts
import { ObjectConfigProvider } from '../../config/verbaConfig';

suite('ObjectConfigProvider', () => {
	test('resolves flat, nested, missing and non-object keys', () => {
		const p = new ObjectConfigProvider({ language: 'de', transcription: { language: 'multi' } });
		assert.strictEqual(p.get('language', 'auto'), 'de');
		assert.strictEqual(p.get('transcription.language', 'x'), 'multi');
		assert.strictEqual(p.get('transcription.provider', 'deepgram'), 'deepgram');
		assert.strictEqual(p.get('nope.deep', 'fallback'), 'fallback');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/macos && npm run test:unit`
Expected: FAIL (`ObjectConfigProvider` not exported).

- [ ] **Step 4: Rewrite `verbaConfig.ts` to delegate to core**

Replace the contents of `apps/macos/src/config/verbaConfig.ts` with:
```ts
import { invoke } from '@tauri-apps/api/core';
import {
	resolveConfig,
	resolveActiveTemplate,
	DEFAULT_TEMPLATES,
	type ConfigProvider,
	type Expansion,
	type PipelineContext,
	type ResolvedConfig,
	type Template,
} from '@verba/core';

export { resolveActiveTemplate, DEFAULT_TEMPLATES };
export type { ResolvedConfig, Template };

/** A `ConfigProvider` over a parsed JSON object; resolves dotted keys by walking it. */
export class ObjectConfigProvider implements ConfigProvider {
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

/** Reads the raw config file contents; defaults to the Tauri `read_config` command. */
export type ReadConfig = () => Promise<string>;
const invokeReadConfig: ReadConfig = () => invoke<string>('read_config');

/**
 * Reads and resolves the user config via `@verba/core`. Never throws. `onMalformed`
 * fires only when the file content is present but not valid JSON (absent/unreadable
 * → `"{}"`), so callers can surface a syntax error the user can fix.
 */
export async function loadConfig(
	readConfig: ReadConfig = invokeReadConfig,
	onMalformed?: (err: unknown) => void,
): Promise<ResolvedConfig> {
	let obj: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(await readConfig());
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			obj = parsed as Record<string, unknown>;
		}
	} catch (err) {
		console.warn('[Verba] Could not read/parse config; using defaults:', err);
		onMalformed?.(err);
	}
	return resolveConfig(new ObjectConfigProvider(obj));
}

/** The mutable sinks a resolved config is applied to at runtime. */
export interface ApplyTargets {
	setLanguage(language: string): void;
	setGlossary(terms: string[]): void;
	setExpansions(expansions: Expansion[]): void;
}

/** Applies the wired config values to the running provider/cleanup. */
export function applyConfig(config: ResolvedConfig, targets: ApplyTargets): void {
	targets.setLanguage(config.transcriptionLanguage);
	targets.setGlossary(config.glossary);
	targets.setExpansions(config.expansions);
}

/**
 * Builds the pipeline context for a dictation: injects the active template's
 * prompt, and pins the cleanup language when the user chose a fixed one.
 */
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext {
	const merged: PipelineContext = { ...context, templatePrompt: config.activeTemplate.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	return merged;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/macos && npm run typecheck && npm run test:unit`
Expected: PASS — the new `ObjectConfigProvider` test plus all pre-existing `loadConfig`/`templates`/`cleanupContextFor`/`onMalformed` tests (behavior preserved).

- [ ] **Step 6: Commit**

`git add apps/macos/src/config/verbaConfig.ts apps/macos/src/test/unit/verbaConfig.test.ts` and commit via `/git-workflow:commit`:
```
♻️ refactor(macos): Config-Auflösung an @verba/core delegieren

verbaConfig.ts nutzt jetzt resolveConfig aus Core; lokale Typen/Validierung
entfernt (aus Core re-exportiert). Neuer ObjectConfigProvider für gepunktete
Keys. Dateiformat + onMalformed unverändert.
```

---

### Task 4: macOS Rust — point `include_str!` at the core JSON, delete the macOS copy

**Files:**
- Modify: `apps/macos/src-tauri/src/config.rs:8`
- Delete: `apps/macos/src/config/defaultTemplates.json`

**Interfaces:**
- Consumes: `packages/core/src/config/defaultTemplates.json` (canonical).

- [ ] **Step 1: Repoint the include**

Modify `apps/macos/src-tauri/src/config.rs` line 8:
```rust
pub const DEFAULT_TEMPLATES_JSON: &str =
    include_str!("../../../../packages/core/src/config/defaultTemplates.json");
```
(From `apps/macos/src-tauri/src/`, `../../../../` reaches the repo root.)

- [ ] **Step 2: Delete the now-unused macOS copy**

Run:
```bash
git rm apps/macos/src/config/defaultTemplates.json
```

- [ ] **Step 3: Run Rust tests to verify they pass**

Run: `cd apps/macos/src-tauri && cargo test`
Expected: PASS — `template_choices_falls_back_to_bundled_defaults` still yields 9 choices with `choices[0].0 == "✏️ Freitext"` (core JSON kept the icons); the added `fileTypes` are ignored by the tray reader.

- [ ] **Step 4: Run clippy**

Run: `cd apps/macos/src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: no issues.

- [ ] **Step 5: Commit**

`git add apps/macos/src-tauri/src/config.rs && git rm` (already staged) and commit via `/git-workflow:commit`:
```
♻️ refactor(macos): Rust-Tray liest Default-Templates aus @verba/core

include_str! zeigt auf packages/core/src/config/defaultTemplates.json; die
macOS-lokale Kopie entfällt (Single Source). Parität via bestehende Tests.
```

---

## Phase 3 — VS Code host

### Task 5: VS Code config layer + `Template` unification

**Files:**
- Create: `src/verbaConfig.ts`
- Modify: `src/templatePicker.ts:1-10` (replace local `Template` with the core type)
- Create: `src/test/unit/verbaConfig.test.ts`

**Interfaces:**
- Produces: `resolvedVerbaConfig(): ResolvedConfig`, `transcriptionLanguageOverride(): string | undefined`, `VsCodeConfigProvider`.
- `src/templatePicker.ts` re-exports `Template` from `@verba/core` (superset with `icon?` + `fileTypes?`), so `selectTemplate`/`findTemplateForLanguage` keep compiling.

- [ ] **Step 1: Ensure core is built**

Run: `npm run compile:core`
Expected: no errors.

- [ ] **Step 2: Unify the `Template` type**

Modify `src/templatePicker.ts`: delete the local `Template` interface (lines 1–10, the `/** A prompt template… */ export interface Template { … }` block) and replace with a re-export:
```ts
import type { Template } from '@verba/core';
export type { Template };
```
Leave `QuickPickItem`, `selectTemplate`, `findTemplateForLanguage` unchanged — they use `Template` structurally (core's superset adds optional `icon`, which they ignore).

- [ ] **Step 3: Write the failing test**

Create `src/test/unit/verbaConfig.test.ts` (uses the repo's `Module._load` vscode-stub pattern, as in `statusBarManager.test.ts`):
```ts
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
const { resolvedVerbaConfig, transcriptionLanguageOverride } = require('../../verbaConfig');

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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL (`../../verbaConfig` not found).

- [ ] **Step 5: Create the config layer**

Create `src/verbaConfig.ts`:
```ts
import * as vscode from 'vscode';
import { resolveConfig, type ConfigProvider, type ResolvedConfig } from '@verba/core';

/** Reads `verba.*` settings through VS Code; satisfies core's per-key ConfigProvider. */
class VsCodeConfigProvider implements ConfigProvider {
	get<T>(key: string, defaultValue: T): T {
		return vscode.workspace.getConfiguration('verba').get<T>(key, defaultValue);
	}
}

/** Resolves the shared Verba config from VS Code settings via @verba/core. Fresh each call. */
export function resolvedVerbaConfig(): ResolvedConfig {
	return resolveConfig(new VsCodeConfigProvider());
}

/**
 * The user's explicit `verba.transcription.language`, or `undefined` if unset.
 * Backward-compatible override: when set it drives the transcription language;
 * otherwise the caller falls back to the legacy `verba.language` behavior.
 */
export function transcriptionLanguageOverride(): string | undefined {
	const insp = vscode.workspace.getConfiguration('verba').inspect<string>('transcription.language');
	return insp?.workspaceFolderValue ?? insp?.workspaceValue ?? insp?.globalValue;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (both new tests green).

- [ ] **Step 7: Commit**

`git add src/verbaConfig.ts src/templatePicker.ts src/test/unit/verbaConfig.test.ts` and commit via `/git-workflow:commit`:
```
✨ feat(vscode): Config-Layer über @verba/core + Template aus Core

Neuer VsCodeConfigProvider + resolvedVerbaConfig() liefern validierte
ResolvedConfig; transcriptionLanguageOverride() liest das neue Setting
rückwärtskompatibel. templatePicker nutzt jetzt den Core-Template-Typ.
```

---

### Task 6: Redirect templates, cleanup language, and audioDevice reads to core

**Files:**
- Modify: `src/extension.ts` (`loadTemplates` ~289–298; `resolveLanguage` ~84–93; audioDevice reads ~598, 644, 1565)

**Interfaces:**
- Consumes: `resolvedVerbaConfig` from `./verbaConfig`.

- [ ] **Step 1: Import the config layer**

In `src/extension.ts`, add to the imports near the top:
```ts
import { resolvedVerbaConfig } from './verbaConfig';
```

- [ ] **Step 2: Redirect `loadTemplates`**

Replace the body of `loadTemplates()` (currently reading + filtering `getConfiguration('verba').get<Template[]>('templates', [])`) with:
```ts
	function loadTemplates(): Template[] {
		return resolvedVerbaConfig().templates;
	}
```
This gives VS Code the same all-or-nothing validation as macOS.

- [ ] **Step 3: Redirect the cleanup language read**

In `resolveLanguage()`, replace:
```ts
	const setting = vscode.workspace.getConfiguration('verba').get<string>('language', 'auto');
```
with:
```ts
	const setting = resolvedVerbaConfig().language;
```
(Leave the rest of `resolveLanguage` — the `!== 'auto'` / ISO-validation logic — unchanged.)

- [ ] **Step 4: Redirect the audioDevice reads**

At each of the three sites, replace `vscode.workspace.getConfiguration('verba').get<string>('audioDevice', '')` (and the adjacent `.trim() || undefined` where present) with the resolved value:
- Line ~598: `let audioDevice = resolvedVerbaConfig().audioDevice;` (core already trims and maps blank → undefined; drop the trailing `.trim() || undefined`).
- Line ~644: `const currentDevice = resolvedVerbaConfig().audioDevice ?? '';`
- Line ~1565: `const preferredDevice = resolvedVerbaConfig().audioDevice;`

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `npm run test:unit`
Expected: PASS (existing VS Code suite green; behavior preserved for valid configs).

- [ ] **Step 6: Commit**

`git add src/extension.ts` and commit via `/git-workflow:commit`:
```
♻️ refactor(vscode): Templates/Sprache/audioDevice über @verba/core lesen

loadTemplates, resolveLanguage und die audioDevice-Reads laufen jetzt über
resolvedVerbaConfig() — VS Code erhält die all-or-nothing-Template-
Validierung; Verhalten für gültige Configs unverändert.
```

---

### Task 7: Route glossary/expansions setting-level validation through core (keep workspace merge)

**Files:**
- Modify: `src/extension.ts` (`loadGlossary` ~300–320; `loadExpansions` ~192–205)

**Interfaces:**
- Consumes: `resolvedVerbaConfig` from `./verbaConfig`.

- [ ] **Step 1: Redirect the glossary setting read**

In `loadGlossary()`, replace the setting-level read + filter:
```ts
		const rawGlobalTerms = vscode.workspace
			.getConfiguration('verba')
			.get<unknown[]>('glossary', []);
		const globalTerms = (Array.isArray(rawGlobalTerms) ? rawGlobalTerms : [])
			.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
```
with:
```ts
		const globalTerms = resolvedVerbaConfig().glossary;
```
Leave the workspace-file (`.verba-glossary.json`) reading and merge below it unchanged.

- [ ] **Step 2: Redirect the expansions setting read**

In `loadExpansions()`, replace the setting-level read + filter + skipped-count warning block (the portion reading `getConfiguration('verba').get<unknown[]>('expansions', [])` and filtering via `isValidExpansion`) with:
```ts
		const globalExpansions = resolvedVerbaConfig().expansions;
```
Leave the workspace-file (`.verba-expansions.json`) reading, its warnings, and the final case-folding merge unchanged.

Note: core validates the setting array (drops invalid entries silently); the VS-Code-specific "skipped N invalid entries" warning for the *setting* is removed, but the equivalent warning for the *workspace file* stays. This matches the spec's "setting-level only" boundary.

- [ ] **Step 3: Run tests + typecheck to verify green**

Run: `npm run test:unit`
Expected: PASS (workspace-merge behavior preserved; setting-level validation now via core).

- [ ] **Step 4: Commit**

`git add src/extension.ts` and commit via `/git-workflow:commit`:
```
♻️ refactor(vscode): Glossar/Expansions-Setting-Ebene über @verba/core

Der Setting-Anteil von loadGlossary/loadExpansions nutzt jetzt die Core-
Validierung; der Workspace-Datei-Merge (.verba-glossary/.verba-expansions.json)
bleibt host-seitig unverändert.
```

---

### Task 8: Add `verba.transcription.language` + backward-compatible override wiring

**Files:**
- Modify: `package.json` (`contributes.configuration.properties`)
- Modify: `src/extension.ts` (`applyLanguageSetting` ~162–176)

**Interfaces:**
- Consumes: `transcriptionLanguageOverride` from `./verbaConfig`.

- [ ] **Step 1: Add the setting to the manifest**

In `package.json`, under `contributes.configuration.properties`, add after `verba.transcription.localModel`:
```json
"verba.transcription.language": {
  "type": "string",
  "default": "multi",
  "enum": ["multi", "de", "en", "fr", "es", "it", "nl", "pt"],
  "description": "Transcription language. 'multi' uses Deepgram's multilingual model; a fixed code (e.g. 'de') forces that language. Optional override — when unset, 'verba.language' drives transcription (legacy behavior)."
}
```

- [ ] **Step 2: Import the override helper**

In `src/extension.ts`, extend the config-layer import:
```ts
import { resolvedVerbaConfig, transcriptionLanguageOverride } from './verbaConfig';
```

- [ ] **Step 3: Wire the override into `applyLanguageSetting`**

Replace the body of `applyLanguageSetting()` so the new setting wins when explicitly set, else the legacy `verba.language` path runs unchanged:
```ts
	function applyLanguageSetting(): string {
		const override = transcriptionLanguageOverride();
		if (override !== undefined) {
			// New explicit setting: 'multi' is Deepgram's multilingual mode, which
			// this host expresses as 'auto'.
			const language = override === 'multi' ? 'auto' : override;
			transcriptionService.setLanguage(language);
			console.log(`[Verba] Transcription language (transcription.language): ${language}`);
			return language;
		}
		// Legacy: derive transcription language from verba.language (back-compat).
		const raw = resolvedVerbaConfig().language;
		let language = raw;
		if (raw !== 'auto' && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(raw)) {
			console.warn(`[Verba] Invalid language setting "${raw}", falling back to auto`);
			vscode.window.showWarningMessage(
				`Verba: Language "${raw}" is not a valid language code (e.g. "de", "en", "fr"). Falling back to auto-detect.`
			);
			language = 'auto';
		}
		transcriptionService.setLanguage(language);
		console.log(`[Verba] Transcription language: ${language === 'auto' ? 'multi (auto-detect)' : language}`);
		return language;
	}
```

- [ ] **Step 4: Write the failing test**

Add to `src/test/unit/verbaConfig.test.ts`:
```ts
suite('transcription language override semantics', () => {
	teardown(() => { fakeConfig = {}; });

	test('override maps "multi" to "auto" and passes a fixed code through', () => {
		fakeConfig = { 'transcription.language': 'multi' };
		assert.strictEqual(transcriptionLanguageOverride(), 'multi');
		fakeConfig = { 'transcription.language': 'de' };
		assert.strictEqual(transcriptionLanguageOverride(), 'de');
	});
});
```
(The 'multi'→'auto' mapping itself is asserted at the unit boundary of `transcriptionLanguageOverride` returning the raw value; the mapping lives in `applyLanguageSetting` and is exercised by the extension integration path.)

- [ ] **Step 5: Run tests to verify green**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

`git add package.json src/extension.ts src/test/unit/verbaConfig.test.ts` and commit via `/git-workflow:commit`:
```
✨ feat(vscode): verba.transcription.language (rückwärtskompatibler Override)

Neues Setting schließt die Sprach-Lücke zu macOS. Ist es gesetzt, bestimmt es
die Transkriptionssprache (multi→auto); sonst gilt weiter verba.language.
Cleanup-Sprache unverändert.
```

---

### Task 9: Align `package.json` template defaults with core + parity test

**Files:**
- Modify: `package.json` (`verba.templates` default)
- Create: `src/test/unit/templateParity.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_TEMPLATES` from `@verba/core`; `packages/core/src/config/defaultTemplates.json`.

- [ ] **Step 1: Write the failing parity test**

Create `src/test/unit/templateParity.test.ts`:
```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_TEMPLATES } from '@verba/core';

suite('template defaults parity (package.json ↔ @verba/core)', () => {
	test('verba.templates default deep-equals core DEFAULT_TEMPLATES', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'));
		const props = pkg.contributes.configuration.properties;
		const manifestDefault = props['verba.templates'].default;
		assert.deepStrictEqual(manifestDefault, DEFAULT_TEMPLATES);
	});
});
```
(Adjust the `../../../package.json` depth if the compiled test lands elsewhere; the test dir compiles to `out/test/unit/`, so repo root is three levels up.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL (manifest default lacks `icon`s and differs from core).

- [ ] **Step 3: Update the manifest default to the canonical union**

Replace the `verba.templates` `default` array in `package.json` with the exact contents of `packages/core/src/config/defaultTemplates.json` (the 9 unioned templates, each with `name`, `icon`, `prompt`, plus `contextAware` on the 3 context-aware ones and `fileTypes` on JavaDoc/Markdown). The two must be byte-equal in structure so `deepStrictEqual` passes.

Run (to copy the canonical array as a starting point for the edit):
```bash
cat packages/core/src/config/defaultTemplates.json
```
Paste it as the `default` value, preserving surrounding manifest formatting.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (parity holds).

- [ ] **Step 5: Commit**

`git add package.json src/test/unit/templateParity.test.ts` and commit via `/git-workflow:commit`:
```
✅ test(vscode): Template-Defaults an @verba/core angleichen + Paritätstest

package.json verba.templates entspricht jetzt exakt der kanonischen
Core-Vorlagenliste (Icons + fileTypes); ein Test bricht bei Drift.
```

---

## Final verification (after all tasks)

- [ ] **Step 1: Full build + all suites**

Run from repo root:
```bash
npm run compile && npm run test:unit
```
Expected: core suite, VS Code suite, and macOS suite (`cd apps/macos && npm run test:unit`) all green.

- [ ] **Step 2: macOS Rust gates**

Run:
```bash
cd apps/macos/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```
Expected: all tests pass, no clippy warnings.

- [ ] **Step 3: Typechecks**

Run:
```bash
cd apps/macos && npm run typecheck
```
Expected: clean.

---

## Self-Review notes (author)

- **Spec coverage:** core schema (T1–T2), macOS adapter (T3–T4), VS Code adapter + redirects (T5–T8), transcription.language override (T8), parity test (T9) — all spec sections mapped.
- **Type consistency:** `ResolvedConfig`/`Template`/`resolveConfig`/`resolveActiveTemplate` names used identically across core, macOS re-export, and VS Code. `ObjectConfigProvider`/`VsCodeConfigProvider` both implement `ConfigProvider.get<T>`.
- **Known follow-ups (out of scope):** sharing `applyConfig`/`cleanupContextFor` into core; migrating VS-Code-only settings.
