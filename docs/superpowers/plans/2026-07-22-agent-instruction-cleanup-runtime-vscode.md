# Agent-Instruction Cleanup — Runtime Wiring + VS Code Detection (Plan 2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plan 1's dormant `outputLanguage` field live at runtime on both hosts, and auto-select the "Agent Instruction" template when VS Code dictation is initiated from a focused terminal.

**Architecture:** Pure host TypeScript. Both hosts already build a `PipelineContext` from the active template; this plan adds the one missing field (`outputLanguage`) at each build site, and extracts VS Code's inline auto-select logic into a testable pure helper that also handles the terminal→agent case. No `@verba/core` source change — `Template.outputLanguage` and `PipelineContext.outputLanguage` already exist in `dist/` from Plan 1.

**Tech Stack:** TypeScript (strict), Mocha + Sinon, npm workspaces.

**Scope note:** This is **Plan 2A of the Plan-2 pair**. It is all-TypeScript, shippable on its own. **Plan 2B** adds macOS native surface detection (Rust FFI: NSWorkspace bundle-id + AX window-title markers + `herdr api snapshot`), the detection config schema, and the macOS host wiring that overrides the active template per detected surface. VS Code's terminal→agent selection here is the app-class tier; deeper agent-state detection inside VS Code's integrated terminal (shell-integration markers) is a later refinement.

## Global Constraints

- TypeScript strict; follow existing patterns in each edited file.
- No `@verba/core` source change in this plan; therefore no `npm run compile:core` is required. Hosts already import the Plan-1 `dist/` that carries the `outputLanguage` fields.
- The bundled agent template's name is exactly `"Agent Instruction"` (from Plan 1). Reference it via a single exported constant, never a repeated string literal.
- VS Code unit tests: `npm run test:unit` (runs VS Code mocha + core; `--grep` does NOT forward through the nested npm scripts — it runs the full suite). macOS unit tests: `npm --workspace apps/macos run test:unit`.
- Commits go through `/git-workflow:commit` (project rule — German, emoji conventional, no auto-signatures). Never raw `git commit`.

---

### Task 1: Wire `outputLanguage` from the active template into the pipeline context (both hosts)

**Files:**
- Modify: `src/extension.ts:401-406` (single-shot) and `src/extension.ts:1443-1447` (continuous)
- Modify: `apps/macos/src/config/verbaConfig.ts:76-82` (`cleanupContextFor`)
- Test: `apps/macos/src/test/unit/verbaConfig.test.ts` (new `cleanupContextFor outputLanguage` suite)

**Interfaces:**
- Consumes: `PipelineContext.outputLanguage?: string` and `Template.outputLanguage?: string` (both from `@verba/core`, added in Plan 1). `cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext`.
- Produces: on both hosts, `PipelineContext.outputLanguage` is populated from the active template's `outputLanguage` (undefined when the template has none). No behavioral change when the template does not set it.

- [ ] **Step 1: Write the failing macOS test**

Add to `apps/macos/src/test/unit/verbaConfig.test.ts` (a new top-level suite; add `import { cleanupContextFor } from '../../config/verbaConfig';` and `import type { ResolvedConfig, Template } from '@verba/core';` if not already imported):

```typescript
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
```

- [ ] **Step 2: Run the macOS test to verify it fails**

Run: `npm --workspace apps/macos run test:unit`
Expected: FAIL — the first test fails (`ctx.outputLanguage` is `undefined`, expected `'en'`) because `cleanupContextFor` does not copy the field yet.

- [ ] **Step 3: Populate `outputLanguage` in `cleanupContextFor`**

In `apps/macos/src/config/verbaConfig.ts`, change the function body (currently lines ~76-82):

```typescript
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext {
	const merged: PipelineContext = { ...context, templatePrompt: config.activeTemplate.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	return merged;
}
```

to add the `outputLanguage` copy before the `return`:

```typescript
export function cleanupContextFor(config: ResolvedConfig, context?: PipelineContext): PipelineContext {
	const merged: PipelineContext = { ...context, templatePrompt: config.activeTemplate.prompt };
	if (config.language !== 'auto') {
		merged.detectedLanguage = config.language;
	}
	if (config.activeTemplate.outputLanguage) {
		merged.outputLanguage = config.activeTemplate.outputLanguage;
	}
	return merged;
}
```

- [ ] **Step 4: Run the macOS test to verify it passes**

Run: `npm --workspace apps/macos run test:unit`
Expected: PASS (both new tests; existing macOS suite still green).

- [ ] **Step 5: Wire the two VS Code build sites**

In `src/extension.ts`, single-shot context (lines ~401-406) — add the `outputLanguage` line:

```typescript
				const pipelineContext: PipelineContext = {
					templatePrompt: selectedTemplate?.prompt,
					outputLanguage: selectedTemplate?.outputLanguage,
					contextSnippets,
					selectedText: capturedSelectedText,
					detectedLanguage: resolveLanguage(transcriptionResult.detectedLanguage),
				};
```

And the continuous context (lines ~1443-1447):

```typescript
						const pipelineContext: PipelineContext = {
							templatePrompt: continuousTemplate?.prompt,
							outputLanguage: continuousTemplate?.outputLanguage,
							selectedText: capturedText,
							detectedLanguage: resolveLanguage(event.detectedLanguage),
						};
```

(The VS Code sites are inline inside large command handlers with no unit-test seam. They are verified by the compile in Step 6; the runtime effect — that a set `outputLanguage` produces the fixation directive — is already covered by the core `prepareRequest` tests from Plan 1. This asymmetry is deliberate: the pure macOS `cleanupContextFor` is unit-tested; the inline VS Code build is typecheck-verified.)

- [ ] **Step 6: Compile the VS Code extension to verify the wiring typechecks**

Run: `npm run compile`
Expected: exits 0 (no TS errors). `outputLanguage` is a known optional field on both `Template` and `PipelineContext`, so the additions typecheck.

- [ ] **Step 7: Run the full VS Code + core suite (no regression)**

Run: `npm run test:unit`
Expected: PASS — VS Code and core suites unchanged (no test asserted the absence of `outputLanguage`).

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts apps/macos/src/config/verbaConfig.ts apps/macos/src/test/unit/verbaConfig.test.ts
```
Then commit via `/git-workflow:commit`. Suggested message:
`✨ feat: outputLanguage aus aktivem Template in den Cleanup-Kontext reichen (beide Hosts)`

---

### Task 2: VS Code — auto-select "Agent Instruction" on terminal-initiated dictation

**Files:**
- Modify: `src/templatePicker.ts` (new exported constant + `chooseAutoTemplate` helper)
- Modify: `src/extension.ts:536-545` (single-shot auto-select) and `src/extension.ts:1376-1385` (continuous auto-select)
- Test: `src/test/unit/templatePicker.test.ts` (new `chooseAutoTemplate` suite)

**Interfaces:**
- Consumes: `Template` (`@verba/core`), existing `findTemplateForLanguage(templates, languageId)`.
- Produces:
  - `export const AGENT_INSTRUCTION_TEMPLATE_NAME = 'Agent Instruction';`
  - `export function chooseAutoTemplate(templates: Template[], opts: { forTerminal: boolean; languageId?: string }): Template | undefined` — when `forTerminal`, returns the template named `AGENT_INSTRUCTION_TEMPLATE_NAME` (or `undefined` if absent); otherwise delegates to `findTemplateForLanguage` when `languageId` is set; otherwise `undefined`.

- [ ] **Step 1: Write the failing helper test**

Add to `src/test/unit/templatePicker.test.ts` (import `chooseAutoTemplate` and `AGENT_INSTRUCTION_TEMPLATE_NAME` from `../../templatePicker`; reuse or define a local `templates` fixture that includes one `{ name: 'Agent Instruction', prompt: 'a' }`, one `{ name: 'JavaDoc', prompt: 'j', fileTypes: ['java'] }`, and one `{ name: 'Freitext', prompt: 'f' }`):

```typescript
suite('chooseAutoTemplate', () => {
	const templates = [
		{ name: 'Freitext', prompt: 'f' },
		{ name: 'JavaDoc', prompt: 'j', fileTypes: ['java'] },
		{ name: 'Agent Instruction', prompt: 'a' },
	];

	test('terminal dictation selects the Agent Instruction template', () => {
		const t = chooseAutoTemplate(templates, { forTerminal: true, languageId: 'java' });
		assert.strictEqual(t?.name, AGENT_INSTRUCTION_TEMPLATE_NAME);
	});

	test('terminal dictation returns undefined when no Agent Instruction template exists', () => {
		const without = templates.filter(t => t.name !== 'Agent Instruction');
		const t = chooseAutoTemplate(without, { forTerminal: true });
		assert.strictEqual(t, undefined);
	});

	test('non-terminal dictation with a matching languageId selects the file-type template', () => {
		const t = chooseAutoTemplate(templates, { forTerminal: false, languageId: 'java' });
		assert.strictEqual(t?.name, 'JavaDoc');
	});

	test('non-terminal dictation without a languageId returns undefined', () => {
		const t = chooseAutoTemplate(templates, { forTerminal: false });
		assert.strictEqual(t, undefined);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `chooseAutoTemplate` is not exported (compile error / undefined).

- [ ] **Step 3: Implement the helper**

Append to `src/templatePicker.ts`:

```typescript
/** The bundled template used for dictation into an AI-agent surface (e.g. a focused terminal). */
export const AGENT_INSTRUCTION_TEMPLATE_NAME = 'Agent Instruction';

/**
 * Chooses a template automatically from the dictation surface:
 * a focused terminal → the Agent Instruction template; otherwise the active
 * file's type-matched template. Returns undefined when nothing matches (the
 * caller then falls back to the last-used template or the picker).
 */
export function chooseAutoTemplate(
	templates: Template[],
	opts: { forTerminal: boolean; languageId?: string },
): Template | undefined {
	if (opts.forTerminal) {
		return templates.find(t => t.name === AGENT_INSTRUCTION_TEMPLATE_NAME);
	}
	if (opts.languageId) {
		return findTemplateForLanguage(templates, opts.languageId);
	}
	return undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (all four `chooseAutoTemplate` tests).

- [ ] **Step 5: Use the helper at the single-shot call site**

In `src/extension.ts`, replace the auto-select block (lines ~536-545):

```typescript
				const autoSelect = vscode.workspace.getConfiguration('verba').get<boolean>('autoSelectTemplate', true);
				if (autoSelect && !forTerminal) {
					const languageId = vscode.window.activeTextEditor?.document.languageId;
					if (languageId) {
						template = findTemplateForLanguage(templates, languageId);
						if (template) {
							console.log(`[Verba] Auto-selected template "${template.name}" for language "${languageId}"`);
						}
					}
				}
```

with:

```typescript
				const autoSelect = vscode.workspace.getConfiguration('verba').get<boolean>('autoSelectTemplate', true);
				if (autoSelect) {
					const languageId = forTerminal ? undefined : vscode.window.activeTextEditor?.document.languageId;
					template = chooseAutoTemplate(templates, { forTerminal, languageId });
					if (template) {
						console.log(`[Verba] Auto-selected template "${template.name}" (${forTerminal ? 'terminal→agent' : `file-type ${languageId}`})`);
					}
				}
```

Ensure `chooseAutoTemplate` is added to the existing `import { … } from './templatePicker';` statement in `src/extension.ts`.

- [ ] **Step 6: Use the helper at the continuous call site**

Continuous dictation targets the editor (never a terminal). In `src/extension.ts`, replace the continuous auto-select block (lines ~1376-1385):

```typescript
			const autoSelect = vscode.workspace.getConfiguration('verba').get<boolean>('autoSelectTemplate', true);
			if (autoSelect) {
				const languageId = vscode.window.activeTextEditor?.document.languageId;
				if (languageId) {
					template = findTemplateForLanguage(templates, languageId);
					if (template) {
						console.log(`[Verba] Continuous: Auto-selected template "${template.name}" for language "${languageId}"`);
					}
				}
			}
```

with:

```typescript
			const autoSelect = vscode.workspace.getConfiguration('verba').get<boolean>('autoSelectTemplate', true);
			if (autoSelect) {
				const languageId = vscode.window.activeTextEditor?.document.languageId;
				template = chooseAutoTemplate(templates, { forTerminal: false, languageId });
				if (template) {
					console.log(`[Verba] Continuous: Auto-selected template "${template.name}" for language "${languageId}"`);
				}
			}
```

If `findTemplateForLanguage` is now unused in `src/extension.ts` after these two edits, remove it from the import to avoid an unused-import lint error; keep it exported from `templatePicker.ts` (the helper and the test still use it).

- [ ] **Step 7: Compile and run the full suite**

Run: `npm run test:unit`
Expected: PASS — the four new helper tests plus the unchanged VS Code + core suites. (`npm run test:unit` compiles first, so a TS error in the extension edits fails here.)

- [ ] **Step 8: Commit**

```bash
git add src/templatePicker.ts src/extension.ts src/test/unit/templatePicker.test.ts
```
Then commit via `/git-workflow:commit`. Suggested message:
`✨ feat(vscode): Terminal-Diktat wählt automatisch das Agent-Instruction-Template`

---

## Self-Review

**Spec coverage (for the Plan-2A slice):**
- `outputLanguage` runtime wiring on both hosts → Task 1 (VS Code 2 sites + macOS `cleanupContextFor`). ✅
- VS Code context-based activation: terminal focus → Agent Instruction → Task 2 (`chooseAutoTemplate`, wired at both auto-select sites). ✅
- macOS native detection, detection config schema, macOS per-dictation template override → **Plan 2B** (out of scope here, stated in the Scope note). Not a gap.
- Manual override preserved: `chooseAutoTemplate` runs only under the existing `autoSelectTemplate` flag; the last-used-template and picker fallbacks below it are unchanged. ✅

**Placeholder scan:** No TBD/TODO; every step has complete code and an exact command with expected output. The two `src/extension.ts` line ranges are given with the verbatim current code to replace. ✅

**Type consistency:** `outputLanguage` is read as `selectedTemplate?.outputLanguage` / `continuousTemplate?.outputLanguage` / `config.activeTemplate.outputLanguage` — all optional `string`, matching the `Template`/`PipelineContext` fields from Plan 1. `AGENT_INSTRUCTION_TEMPLATE_NAME` is the single source for the `"Agent Instruction"` string, used in the helper and referenced (by value) by the Plan-1 template. `chooseAutoTemplate`'s `{ forTerminal; languageId? }` options object is identical across its definition, tests, and both call sites. ✅
