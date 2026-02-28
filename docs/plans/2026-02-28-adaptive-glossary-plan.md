# Adaptive Personal Dictionary — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A command that scans workspace files for project-specific terms and merges user-approved suggestions into `.verba-glossary.json`.

**Architecture:** A `GlossaryGenerator` class scans metadata files, source symbols, and docs via regex. The command in `extension.ts` orchestrates the flow: scan → Quick Pick review → merge into glossary file → reload.

**Tech Stack:** TypeScript, VS Code Extension API (QuickPick, workspace.fs), Mocha/Sinon for tests. No external dependencies.

---

### Task 1: GlossaryGenerator — Filtering and Helpers (Tests First)

**Files:**
- Create: `src/glossaryGenerator.ts` (stub)
- Create: `src/test/unit/glossaryGenerator.test.ts`

**Step 1: Create stub `src/glossaryGenerator.ts`**

```typescript
export const STOPWORDS = new Set<string>([
	'index', 'main', 'test', 'tests', 'spec', 'App', 'app',
	'constructor', 'prototype', 'toString', 'valueOf',
	'get', 'set', 'put', 'post', 'delete', 'patch',
	'true', 'false', 'null', 'undefined', 'void',
	'src', 'dist', 'out', 'build', 'lib', 'bin',
	'module', 'exports', 'require', 'import',
	'describe', 'suite', 'test', 'expect', 'assert',
	'setup', 'teardown', 'before', 'after',
]);

export function filterTerms(raw: string[], existingTerms: string[]): string[] {
	return [];
}

export class GlossaryGenerator {
	async generate(workspaceRoot: string, existingTerms: string[]): Promise<string[]> {
		return [];
	}
}
```

**Step 2: Write failing tests for `filterTerms`**

```typescript
// src/test/unit/glossaryGenerator.test.ts
import * as assert from 'assert';
import { filterTerms, STOPWORDS } from '../../glossaryGenerator';

suite('GlossaryGenerator', () => {
	suite('filterTerms', () => {
		test('removes terms shorter than 3 characters', () => {
			const result = filterTerms(['ab', 'abc', 'a', 'abcd'], []);
			assert.ok(!result.includes('ab'));
			assert.ok(!result.includes('a'));
			assert.ok(result.includes('abc'));
			assert.ok(result.includes('abcd'));
		});

		test('removes stopwords', () => {
			const result = filterTerms(['index', 'main', 'CostTracker'], []);
			assert.deepStrictEqual(result, ['CostTracker']);
		});

		test('removes already existing glossary terms', () => {
			const result = filterTerms(['Verba', 'Whisper', 'Claude'], ['Whisper']);
			assert.ok(result.includes('Verba'));
			assert.ok(result.includes('Claude'));
			assert.ok(!result.includes('Whisper'));
		});

		test('deduplicates terms', () => {
			const result = filterTerms(['Verba', 'Verba', 'Claude'], []);
			assert.strictEqual(result.filter(t => t === 'Verba').length, 1);
		});

		test('sorts alphabetically', () => {
			const result = filterTerms(['Zeta', 'Alpha', 'Mu'], []);
			assert.deepStrictEqual(result, ['Alpha', 'Mu', 'Zeta']);
		});

		test('returns empty array for all-filtered input', () => {
			const result = filterTerms(['a', 'ab', 'index'], []);
			assert.deepStrictEqual(result, []);
		});
	});
});
```

**Step 3: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: FAIL (filterTerms returns `[]`)

**Step 4: Implement `filterTerms`**

```typescript
export function filterTerms(raw: string[], existingTerms: string[]): string[] {
	const existing = new Set(existingTerms);
	const seen = new Set<string>();
	const result: string[] = [];

	for (const term of raw) {
		const trimmed = term.trim();
		if (trimmed.length < 3) { continue; }
		if (STOPWORDS.has(trimmed)) { continue; }
		if (existing.has(trimmed)) { continue; }
		if (seen.has(trimmed)) { continue; }
		seen.add(trimmed);
		result.push(trimmed);
	}

	return result.sort((a, b) => a.localeCompare(b));
}
```

**Step 5: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 6: Commit**

```
git add src/glossaryGenerator.ts src/test/unit/glossaryGenerator.test.ts
/commit
```

---

### Task 2: GlossaryGenerator — Metadata Scanning

**Files:**
- Modify: `src/glossaryGenerator.ts`
- Modify: `src/test/unit/glossaryGenerator.test.ts`

**Step 1: Write failing tests for metadata scanning**

Each `_scan*` method takes file content as a string for testability. Add a public static method `parseMetadata` to expose parsing logic for tests.

```typescript
suite('parsePackageJson', () => {
	test('extracts package name', () => {
		const content = '{"name": "verba", "version": "1.0.0"}';
		const terms = GlossaryGenerator.parsePackageJson(content);
		assert.ok(terms.includes('verba'));
	});

	test('extracts dependency names without scope prefix', () => {
		const content = JSON.stringify({
			name: 'my-app',
			dependencies: { '@anthropic-ai/sdk': '^1.0', 'openai': '^4.0' },
			devDependencies: { 'mocha': '^10.0', '@types/sinon': '^17.0' },
		});
		const terms = GlossaryGenerator.parsePackageJson(content);
		assert.ok(terms.includes('my-app'));
		assert.ok(terms.includes('anthropic-ai/sdk'));
		assert.ok(terms.includes('openai'));
		assert.ok(terms.includes('mocha'));
		assert.ok(terms.includes('sinon'));
	});

	test('returns empty array for invalid JSON', () => {
		const terms = GlossaryGenerator.parsePackageJson('not json');
		assert.deepStrictEqual(terms, []);
	});
});

suite('parsePomXml', () => {
	test('extracts artifactId and groupId', () => {
		const content = `<project>
			<groupId>com.example</groupId>
			<artifactId>my-service</artifactId>
		</project>`;
		const terms = GlossaryGenerator.parsePomXml(content);
		assert.ok(terms.includes('com.example'));
		assert.ok(terms.includes('my-service'));
	});

	test('returns empty array when no matches', () => {
		const terms = GlossaryGenerator.parsePomXml('<project></project>');
		assert.deepStrictEqual(terms, []);
	});
});

suite('parsePyprojectToml', () => {
	test('extracts project name', () => {
		const content = '[project]\nname = "my-package"\nversion = "1.0"';
		const terms = GlossaryGenerator.parsePyprojectToml(content);
		assert.ok(terms.includes('my-package'));
	});

	test('extracts dependency names', () => {
		const content = '[project]\ndependencies = [\n  "requests>=2.0",\n  "flask~=3.0",\n]';
		const terms = GlossaryGenerator.parsePyprojectToml(content);
		assert.ok(terms.includes('requests'));
		assert.ok(terms.includes('flask'));
	});

	test('returns empty array when no matches', () => {
		const terms = GlossaryGenerator.parsePyprojectToml('[tool.ruff]');
		assert.deepStrictEqual(terms, []);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: FAIL (static methods don't exist yet)

**Step 3: Implement the three static parse methods**

In `src/glossaryGenerator.ts`, add to `GlossaryGenerator`:

```typescript
static parsePackageJson(content: string): string[] {
	try {
		const pkg = JSON.parse(content);
		const terms: string[] = [];
		if (typeof pkg.name === 'string') { terms.push(pkg.name); }
		for (const deps of [pkg.dependencies, pkg.devDependencies]) {
			if (deps && typeof deps === 'object') {
				for (const key of Object.keys(deps)) {
					// Strip @ scope prefix: @anthropic-ai/sdk → anthropic-ai/sdk
					// Strip @ scope for single names: @types/sinon → sinon
					if (key.startsWith('@')) {
						const withoutAt = key.slice(1);
						const slashIdx = withoutAt.indexOf('/');
						if (slashIdx !== -1) {
							terms.push(withoutAt); // anthropic-ai/sdk
							terms.push(withoutAt.slice(slashIdx + 1)); // sdk
						}
					} else {
						terms.push(key);
					}
				}
			}
		}
		return terms;
	} catch {
		return [];
	}
}

static parsePomXml(content: string): string[] {
	const terms: string[] = [];
	const groupIdMatch = content.match(/<groupId>([^<]+)<\/groupId>/);
	const artifactIdMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
	if (groupIdMatch) { terms.push(groupIdMatch[1]); }
	if (artifactIdMatch) { terms.push(artifactIdMatch[1]); }
	return terms;
}

static parsePyprojectToml(content: string): string[] {
	const terms: string[] = [];
	const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
	if (nameMatch) { terms.push(nameMatch[1]); }
	const depMatches = content.matchAll(/^\s*"([a-zA-Z0-9_-]+)[^"]*"/gm);
	for (const m of depMatches) {
		if (m[1] && m[1] !== nameMatch?.[1]) { terms.push(m[1]); }
	}
	return terms;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 5: Commit**

```
git add src/glossaryGenerator.ts src/test/unit/glossaryGenerator.test.ts
/commit
```

---

### Task 3: GlossaryGenerator — Symbol Extraction

**Files:**
- Modify: `src/glossaryGenerator.ts`
- Modify: `src/test/unit/glossaryGenerator.test.ts`

**Step 1: Write failing tests for symbol extraction**

```typescript
suite('parseSymbols', () => {
	test('extracts TypeScript classes, interfaces, enums, types, functions', () => {
		const content = `
export class CostTracker {
	constructor() {}
}
interface UsageRecord {}
export enum Status { Active }
type ModelCategory = string;
export function formatCost(n: number): string { return ''; }
`;
		const terms = GlossaryGenerator.parseSymbols(content, 'ts');
		assert.ok(terms.includes('CostTracker'));
		assert.ok(terms.includes('UsageRecord'));
		assert.ok(terms.includes('Status'));
		assert.ok(terms.includes('ModelCategory'));
		assert.ok(terms.includes('formatCost'));
	});

	test('extracts Java classes, interfaces, enums', () => {
		const content = `
public class UserService {
}
private interface Repository {
}
public enum OrderStatus {
}
`;
		const terms = GlossaryGenerator.parseSymbols(content, 'java');
		assert.ok(terms.includes('UserService'));
		assert.ok(terms.includes('Repository'));
		assert.ok(terms.includes('OrderStatus'));
	});

	test('extracts Python top-level classes and functions', () => {
		const content = `
class TranscriptionService:
    def __init__(self):
        pass

    def _private_method(self):
        pass

def process_audio(path: str):
    pass

class CleanupService:
    pass
`;
		const terms = GlossaryGenerator.parseSymbols(content, 'py');
		assert.ok(terms.includes('TranscriptionService'));
		assert.ok(terms.includes('process_audio'));
		assert.ok(terms.includes('CleanupService'));
		assert.ok(!terms.includes('__init__'));
		assert.ok(!terms.includes('_private_method'));
	});

	test('returns empty array for unknown language', () => {
		const terms = GlossaryGenerator.parseSymbols('some content', 'rs');
		assert.deepStrictEqual(terms, []);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: FAIL

**Step 3: Implement `parseSymbols`**

```typescript
static parseSymbols(content: string, language: 'ts' | 'java' | 'py' | string): string[] {
	const terms: string[] = [];
	let pattern: RegExp;

	switch (language) {
		case 'ts':
			pattern = /(?:export\s+)?(?:class|interface|enum|type|function)\s+(\w+)/g;
			break;
		case 'java':
			pattern = /(?:public|private|protected)?\s*(?:class|interface|enum)\s+(\w+)/g;
			break;
		case 'py':
			pattern = /^(?:class|def)\s+(\w+)/gm;
			break;
		default:
			return [];
	}

	for (const match of content.matchAll(pattern)) {
		const name = match[1];
		// Skip Python private/dunder methods
		if (language === 'py' && name.startsWith('_')) { continue; }
		terms.push(name);
	}

	return terms;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 5: Commit**

```
git add src/glossaryGenerator.ts src/test/unit/glossaryGenerator.test.ts
/commit
```

---

### Task 4: GlossaryGenerator — Docs Extraction

**Files:**
- Modify: `src/glossaryGenerator.ts`
- Modify: `src/test/unit/glossaryGenerator.test.ts`

**Step 1: Write failing tests for docs extraction**

```typescript
suite('parseDocs', () => {
	test('extracts markdown headings', () => {
		const content = `# Verba\n## Architecture\n### Cost Tracking\nSome text.`;
		const terms = GlossaryGenerator.parseDocs(content);
		assert.ok(terms.includes('Verba'));
		assert.ok(terms.includes('Architecture'));
		assert.ok(terms.includes('Cost Tracking'));
	});

	test('extracts bold terms', () => {
		const content = `Use **Whisper API** for transcription. The **Claude** model processes text.`;
		const terms = GlossaryGenerator.parseDocs(content);
		assert.ok(terms.includes('Whisper API'));
		assert.ok(terms.includes('Claude'));
	});

	test('ignores deep headings (h4+)', () => {
		const content = `#### Implementation Detail\n##### Very Deep`;
		const terms = GlossaryGenerator.parseDocs(content);
		assert.ok(!terms.includes('Implementation Detail'));
		assert.ok(!terms.includes('Very Deep'));
	});

	test('returns empty array for content without headings or bold', () => {
		const terms = GlossaryGenerator.parseDocs('Just plain text without markup.');
		assert.deepStrictEqual(terms, []);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: FAIL

**Step 3: Implement `parseDocs`**

```typescript
static parseDocs(content: string): string[] {
	const terms: string[] = [];

	// Headings (h1-h3 only)
	for (const match of content.matchAll(/^#{1,3}\s+(.+)$/gm)) {
		terms.push(match[1].trim());
	}

	// Bold terms
	for (const match of content.matchAll(/\*\*([^*]+)\*\*/g)) {
		terms.push(match[1].trim());
	}

	return terms;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npx mocha out/test/unit/glossaryGenerator.test.js --ui tdd --timeout 5000`
Expected: All PASS

**Step 5: Commit**

```
git add src/glossaryGenerator.ts src/test/unit/glossaryGenerator.test.ts
/commit
```

---

### Task 5: GlossaryGenerator — `generate()` Integration

**Files:**
- Modify: `src/glossaryGenerator.ts`

**Step 1: Implement `generate()` method**

Wire the scan methods together. This method reads files from the workspace root and delegates to the static parse methods.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob'; // already a dependency via vscode

async generate(workspaceRoot: string, existingTerms: string[]): Promise<string[]> {
	const rawTerms: string[] = [];

	// Metadata files
	const metadataFiles: Array<{ file: string; parser: (c: string) => string[] }> = [
		{ file: 'package.json', parser: GlossaryGenerator.parsePackageJson },
		{ file: 'pom.xml', parser: GlossaryGenerator.parsePomXml },
		{ file: 'pyproject.toml', parser: GlossaryGenerator.parsePyprojectToml },
	];

	for (const { file, parser } of metadataFiles) {
		const filePath = path.join(workspaceRoot, file);
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			rawTerms.push(...parser(content));
		} catch {
			// File doesn't exist — normal, skip
		}
	}

	// Source symbols
	const langMap: Record<string, string> = { '.ts': 'ts', '.java': 'java', '.py': 'py' };
	const excludeDirs = ['node_modules', 'dist', 'out', '.git', '.verba', '__pycache__', 'target', 'build'];
	const sourceFiles = await vscode.workspace.findFiles(
		'**/*.{ts,java,py}',
		`{${excludeDirs.map(d => `**/${d}/**`).join(',')}}`,
	);

	for (const uri of sourceFiles) {
		const ext = path.extname(uri.fsPath);
		const lang = langMap[ext];
		if (lang) {
			try {
				const content = fs.readFileSync(uri.fsPath, 'utf-8');
				rawTerms.push(...GlossaryGenerator.parseSymbols(content, lang));
			} catch {
				// Unreadable file — skip
			}
		}
	}

	// Documentation
	const docFiles = ['README.md', 'CLAUDE.md'];
	for (const file of docFiles) {
		const filePath = path.join(workspaceRoot, file);
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			rawTerms.push(...GlossaryGenerator.parseDocs(content));
		} catch {
			// File doesn't exist — skip
		}
	}

	return filterTerms(rawTerms, existingTerms);
}
```

**Note:** `generate()` uses `vscode.workspace.findFiles` for symbol scanning. This is the only VS Code API dependency in this class — the static parse methods remain pure and testable without VS Code. We do NOT add unit tests for `generate()` itself since it's an integration method that requires VS Code APIs. It will be tested via the integration test suite.

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```
git add src/glossaryGenerator.ts
/commit
```

---

### Task 6: Command Registration and Wiring

**Files:**
- Modify: `package.json` (add command declaration)
- Modify: `src/extension.ts` (register command, implement workflow)

**Step 1: Add command to `package.json`**

In `package.json`, after line 77 (after the `showCostOverview` command closing `}`), add:

```json
,
{
  "command": "dictation.generateGlossary",
  "title": "Generate Glossary from Project",
  "category": "Verba"
}
```

**Step 2: Register command in `extension.ts`**

At the top of `extension.ts`, add import:

```typescript
import { GlossaryGenerator } from './glossaryGenerator';
```

Before line 790 (before the `context.subscriptions.push` call), add:

```typescript
const generateGlossaryCommand = vscode.commands.registerCommand('dictation.generateGlossary', async () => {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		vscode.window.showWarningMessage('Verba: Open a workspace to generate glossary.');
		return;
	}

	const generator = new GlossaryGenerator();
	const suggestions = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Verba: Scanning project for glossary terms...' },
		() => generator.generate(workspaceRoot, currentGlossary),
	);

	if (suggestions.length === 0) {
		vscode.window.showInformationMessage('Verba: No new glossary terms found in this project.');
		return;
	}

	const items = suggestions.map(term => ({ label: term, picked: true }));
	const selected = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: `${suggestions.length} terms found — deselect any you don't want`,
		title: 'Verba: Review Glossary Suggestions',
	});

	if (!selected || selected.length === 0) {
		return;
	}

	const selectedTerms = selected.map(s => s.label);

	// Load existing glossary file
	const glossaryPath = path.join(workspaceRoot, '.verba-glossary.json');
	let existing: string[] = [];
	try {
		const content = fs.readFileSync(glossaryPath, 'utf-8');
		const parsed = JSON.parse(content);
		if (Array.isArray(parsed)) {
			existing = parsed.filter((t): t is string => typeof t === 'string');
		}
	} catch {
		// File doesn't exist or invalid — start fresh
	}

	// Merge, deduplicate, sort
	const merged = [...new Set([...existing, ...selectedTerms])].sort((a, b) => a.localeCompare(b));
	fs.writeFileSync(glossaryPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

	const added = merged.length - existing.length;
	vscode.window.showInformationMessage(`Verba: ${added} term${added !== 1 ? 's' : ''} added to glossary (${merged.length} total).`);

	// Reload glossary so Whisper + Claude pick it up immediately
	applyGlossary();
});
```

In the `context.subscriptions.push(...)` call on line 791, add `generateGlossaryCommand`:

```typescript
context.subscriptions.push(
	editorCommand, terminalCommand, selectDeviceCommand, selectTemplateCommand,
	indexProjectCommand, downloadModelCommand, manageApiKeysCommand, showCostOverviewCommand,
	generateGlossaryCommand, saveWatcher,
	{ dispose: () => recorder.dispose() }, statusBar,
);
```

**Step 3: Run full test suite**

Run: `npm test`
Expected: All existing tests PASS, no regressions

**Step 4: Commit**

```
git add package.json src/extension.ts
/commit
```

---

### Task 7: Integration Test

**Files:**
- Modify: `src/test/integration/extension.test.ts`

**Step 1: Add integration test for command registration**

Check existing integration tests in `src/test/integration/extension.test.ts` for the pattern. Add:

```typescript
test('dictation.generateGlossary command is registered', async () => {
	const commands = await vscode.commands.getCommands(true);
	assert.ok(commands.includes('dictation.generateGlossary'));
});
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: All PASS including new integration test

**Step 3: Commit**

```
git add src/test/integration/extension.test.ts
/commit
```

---

### Task 8: CLAUDE.md and CHANGELOG.md Updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

**Step 1: Update CLAUDE.md**

In the Conventions section, add after the cost overview line:

```
- Glossary generator: `dictation.generateGlossary` — scan workspace for project-specific terms, review via Quick Pick, merge into `.verba-glossary.json`
```

In the Architecture table, add:

```
| `glossaryGenerator.ts` | Scans workspace for project-specific glossary terms (metadata, symbols, docs) |
```

**Step 2: Update CHANGELOG.md**

In the `[Unreleased]` → `### Added` section, add:

```
- **Adaptive Personal Dictionary (TF-263):** `dictation.generateGlossary` command scans workspace for project-specific terms (package names, class/interface/function names, README/CLAUDE.md headings). Users review suggestions via Multi-Select Quick Pick before merging into `.verba-glossary.json`. Supports TypeScript, Java, and Python projects.
```

**Step 3: Run full test suite one final time**

Run: `npm test`
Expected: All PASS

**Step 4: Commit**

```
git add CLAUDE.md CHANGELOG.md
/commit
```
