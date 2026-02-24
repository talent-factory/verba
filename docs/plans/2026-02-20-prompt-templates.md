# Prompt-Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable prompt templates to Verba so users can select different dictation modes (Freitext, Commit Message, JavaDoc, Markdown, E-Mail) via Quick-Pick before recording.

**Architecture:** The CleanupService gets a dynamic system prompt parameter instead of a hardcoded one. The DictationPipeline passes a PipelineContext through to stages. The extension shows a Quick-Pick before starting the recorder and remembers the last selection.

**Tech Stack:** TypeScript, VS Code Extension API (QuickPick, workspace configuration, workspaceState)

---

### Task 1: Add PipelineContext and update ProcessingStage interface

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `src/test/unit/pipeline.test.ts`

**Step 1: Write the failing tests**

Add two tests to `src/test/unit/pipeline.test.ts`:

```typescript
test('passes context to each stage', async () => {
	const receivedContexts: (PipelineContext | undefined)[] = [];
	pipeline.addStage({
		name: 'spy',
		process: async (input: string, context?: PipelineContext) => {
			receivedContexts.push(context);
			return input;
		},
	});
	const ctx: PipelineContext = { templatePrompt: 'test prompt' };
	await pipeline.run('hello', ctx);
	assert.strictEqual(receivedContexts.length, 1);
	assert.strictEqual(receivedContexts[0]?.templatePrompt, 'test prompt');
});

test('works without context for backward compatibility', async () => {
	pipeline.addStage(createStage('upper', (s) => s.toUpperCase()));
	const result = await pipeline.run('hello');
	assert.strictEqual(result, 'HELLO');
});
```

Import `PipelineContext` at the top alongside the existing imports.

**Step 2: Run tests to verify they fail**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: Compile error — `PipelineContext` does not exist yet.

**Step 3: Implement PipelineContext and update interfaces**

In `src/pipeline.ts`, add `PipelineContext` export and update `ProcessingStage.process` and `DictationPipeline.run`:

```typescript
export interface PipelineContext {
	templatePrompt?: string;
}

export interface ProcessingStage {
	readonly name: string;
	process(input: string, context?: PipelineContext): Promise<string>;
}

export class DictationPipeline {
	private stages: ProcessingStage[] = [];

	addStage(stage: ProcessingStage): void {
		this.stages.push(stage);
	}

	async run(input: string, context?: PipelineContext): Promise<string> {
		let result = input;
		for (const stage of this.stages) {
			result = await stage.process(result, context);
		}
		return result;
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: All pipeline tests pass (7 total including 2 new).

**Step 5: Commit**

```bash
git add src/pipeline.ts src/test/unit/pipeline.test.ts
git commit -m "feat: PipelineContext fuer dynamische Prompt-Durchreichung hinzufuegen"
```

---

### Task 2: Update CleanupService to accept dynamic system prompt

**Files:**
- Modify: `src/cleanupService.ts`
- Modify: `src/test/unit/cleanupService.test.ts`

**Step 1: Write the failing tests**

Add two tests to `src/test/unit/cleanupService.test.ts` inside the `process()` suite. Import `PipelineContext` from `../../pipeline` at top of file.

```typescript
test('uses custom system prompt from context when provided', async () => {
	secretStorage.get.resolves('sk-ant-test-key');
	fakeClient.messages.create.resolves({
		content: [{ type: 'text', text: 'commit: fix login bug' }],
	});

	const context: PipelineContext = {
		templatePrompt: 'Convert to a commit message.',
	};
	await service.process('test input', context);

	const callArgs = fakeClient.messages.create.firstCall.args[0];
	assert.strictEqual(callArgs.system, 'Convert to a commit message.');
});

test('uses default system prompt when no context is provided', async () => {
	secretStorage.get.resolves('sk-ant-test-key');
	fakeClient.messages.create.resolves({
		content: [{ type: 'text', text: 'cleaned' }],
	});

	await service.process('test input');

	const callArgs = fakeClient.messages.create.firstCall.args[0];
	assert.ok(callArgs.system.includes('Füllwörter'), 'should use default filler word prompt');
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: First test FAILS — `process()` ignores the context parameter, system prompt still contains 'Füllwörter'.

**Step 3: Update CleanupService.process signature and implementation**

In `src/cleanupService.ts`:

1. Add import: `import { ProcessingStage, PipelineContext } from './pipeline';`
2. Change `process` signature: `async process(input: string, context?: PipelineContext): Promise<string>`
3. Use `context?.templatePrompt` if provided, otherwise fall back to `CLEANUP_SYSTEM_PROMPT`:

```typescript
async process(input: string, context?: PipelineContext): Promise<string> {
	const apiKey = await this.getApiKey();
	const client = this.getClient(apiKey);
	const systemPrompt = context?.templatePrompt ?? CLEANUP_SYSTEM_PROMPT;

	let response;
	try {
		response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 4096,
			system: systemPrompt,
			messages: [{ role: 'user', content: input }],
		});
	} catch (err: unknown) {
		// ... existing error handling unchanged
	}
	// ... rest unchanged
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: All CleanupService tests pass (13 total including 2 new).

**Step 5: Commit**

```bash
git add src/cleanupService.ts src/test/unit/cleanupService.test.ts
git commit -m "feat: CleanupService akzeptiert dynamischen System-Prompt via PipelineContext"
```

---

### Task 3: Register verba.templates setting in package.json

**Files:**
- Modify: `package.json`

**Step 1: Add the setting definition**

In `package.json` under `contributes.configuration.properties`, add:

```jsonc
"verba.templates": {
  "type": "array",
  "description": "Dictation templates that control how the transcribed text is post-processed by Claude.",
  "items": {
    "type": "object",
    "required": ["name", "prompt"],
    "properties": {
      "name": {
        "type": "string",
        "description": "Display name shown in the Quick-Pick menu."
      },
      "prompt": {
        "type": "string",
        "description": "System prompt sent to Claude for post-processing the transcript."
      }
    }
  },
  "default": [
    {
      "name": "Freitext",
      "prompt": "Clean up the transcript: remove filler words (um, uh, like, you know, halt, eigentlich, sozusagen, quasi), smooth broken or repeated sentence starts, fix obvious transcription errors. Keep the original language and meaning exactly. Return only the cleaned text without explanation."
    },
    {
      "name": "Commit Message",
      "prompt": "Convert this transcript into a Git commit message following Conventional Commits format. First line: type(scope): short description. Optional body after blank line for details. Keep the original language. Return only the commit message without explanation."
    },
    {
      "name": "JavaDoc",
      "prompt": "Convert this transcript into a JavaDoc comment block (/** ... */). Structure with @param, @return, @throws tags as appropriate based on the described function. Keep the original language. Return only the JavaDoc block without explanation."
    },
    {
      "name": "Markdown",
      "prompt": "Convert this transcript into well-structured Markdown text. Use headings, bullet lists, numbered lists, and emphasis as appropriate. Keep the original language. Return only the Markdown without explanation."
    },
    {
      "name": "E-Mail",
      "prompt": "Convert this transcript into a professional email with appropriate greeting and closing. Maintain the original language and intended tone (formal or informal). Return only the email text without explanation."
    }
  ]
}
```

**Step 2: Verify compilation**

Run: `npm run compile 2>&1`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: verba.templates Setting mit 5 Standard-Templates registrieren"
```

---

### Task 4: Implement template selection and Quick-Pick in extension.ts

**Files:**
- Create: `src/templatePicker.ts`
- Create: `src/test/unit/templatePicker.test.ts`
- Modify: `src/extension.ts`

**Step 1: Write the failing tests for templatePicker**

Create `src/test/unit/templatePicker.test.ts`:

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';

import { selectTemplate, Template } from '../../templatePicker';

const DEFAULT_TEMPLATES: Template[] = [
	{ name: 'Freitext', prompt: 'Clean up the transcript.' },
	{ name: 'Commit Message', prompt: 'Convert to commit message.' },
];

suite('selectTemplate', () => {
	teardown(() => {
		sinon.restore();
	});

	test('returns selected template', async () => {
		const showQuickPick = sinon.stub().resolves({ label: 'Freitext', template: DEFAULT_TEMPLATES[0] });

		const result = await selectTemplate(DEFAULT_TEMPLATES, undefined, showQuickPick);

		assert.deepStrictEqual(result, DEFAULT_TEMPLATES[0]);
	});

	test('returns undefined when user cancels Quick-Pick', async () => {
		const showQuickPick = sinon.stub().resolves(undefined);

		const result = await selectTemplate(DEFAULT_TEMPLATES, undefined, showQuickPick);

		assert.strictEqual(result, undefined);
	});

	test('preselects last used template', async () => {
		const showQuickPick = sinon.stub().resolves({ label: 'Commit Message', template: DEFAULT_TEMPLATES[1] });

		await selectTemplate(DEFAULT_TEMPLATES, 'Commit Message', showQuickPick);

		const items = showQuickPick.firstCall.args[0];
		const activeItems = showQuickPick.firstCall.args[1]?.activeItems;
		assert.ok(activeItems, 'should set activeItems');
		assert.strictEqual(activeItems[0].label, 'Commit Message');
	});

	test('returns first template when lastUsed does not match', async () => {
		const showQuickPick = sinon.stub().resolves({ label: 'Freitext', template: DEFAULT_TEMPLATES[0] });

		await selectTemplate(DEFAULT_TEMPLATES, 'Nonexistent', showQuickPick);

		const activeItems = showQuickPick.firstCall.args[1]?.activeItems;
		assert.strictEqual(activeItems, undefined);
	});

	test('throws when templates array is empty', async () => {
		const showQuickPick = sinon.stub();

		await assert.rejects(
			() => selectTemplate([], undefined, showQuickPick),
			/No templates configured/
		);
		assert.ok(showQuickPick.notCalled);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile 2>&1`
Expected: Compile error — `templatePicker` module does not exist.

**Step 3: Implement templatePicker.ts**

Create `src/templatePicker.ts`:

```typescript
export interface Template {
	name: string;
	prompt: string;
}

interface QuickPickItem {
	label: string;
	template: Template;
}

type ShowQuickPickFn = (
	items: QuickPickItem[],
	options?: { placeHolder?: string; activeItems?: QuickPickItem[] },
) => Thenable<QuickPickItem | undefined>;

export async function selectTemplate(
	templates: Template[],
	lastUsedName: string | undefined,
	showQuickPick: ShowQuickPickFn,
): Promise<Template | undefined> {
	if (templates.length === 0) {
		throw new Error('No templates configured. Add templates in settings under verba.templates.');
	}

	const items: QuickPickItem[] = templates.map((t) => ({
		label: t.name,
		template: t,
	}));

	const lastUsedItem = lastUsedName
		? items.find((item) => item.label === lastUsedName)
		: undefined;

	const options: { placeHolder: string; activeItems?: QuickPickItem[] } = {
		placeHolder: 'Select dictation template',
	};
	if (lastUsedItem) {
		options.activeItems = [lastUsedItem];
	}

	const selected = await showQuickPick(items, options);
	return selected?.template;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: All templatePicker tests pass (5 new), all existing tests still pass.

**Step 5: Commit**

```bash
git add src/templatePicker.ts src/test/unit/templatePicker.test.ts
git commit -m "feat: Template-Auswahl mit Quick-Pick und Last-Used-Memory implementieren"
```

---

### Task 5: Wire template selection into extension.ts

**Files:**
- Modify: `src/extension.ts`

**Step 1: Update extension.ts to show Quick-Pick and pass template through pipeline**

Changes to `src/extension.ts`:

1. Add imports:
```typescript
import { selectTemplate, Template } from './templatePicker';
import { PipelineContext } from './pipeline';
```

2. Add state variable after `const pipeline = new DictationPipeline();`:
```typescript
let selectedTemplate: Template | undefined;
```

3. In the `dictation.start` command handler, modify the `else` branch (when not recording) to show Quick-Pick before starting the recorder:

```typescript
} else {
	try {
		// Load templates from settings
		const templates = vscode.workspace
			.getConfiguration('verba')
			.get<Template[]>('templates', []);
		const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');

		// Show Quick-Pick for template selection
		const template = await selectTemplate(
			templates,
			lastUsedName,
			(items, options) => vscode.window.showQuickPick(items, options) as any,
		);
		if (!template) {
			return; // User cancelled
		}
		selectedTemplate = template;
		await context.workspaceState.update('verba.lastTemplateName', template.name);

		await recorder.start();
		statusBar.setRecording();
		vscode.window.showInformationMessage(
			`Verba: Recording started (${template.name})...`
		);
	} catch (err: unknown) {
		// ... existing error handling unchanged
	}
}
```

4. In the recording-stop branch, pass the template prompt as pipeline context:

```typescript
const pipelineContext: PipelineContext | undefined = selectedTemplate
	? { templatePrompt: selectedTemplate.prompt }
	: undefined;
const transcript = await pipeline.run(filePath, pipelineContext);
```

**Step 2: Verify compilation and all tests pass**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: Compiles clean, all tests pass.

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: Template Quick-Pick in Diktat-Workflow integrieren"
```

---

### Task 6: Verify full workflow and finalize

**Step 1: Run all tests**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: All tests pass (approximately 62+ tests).

**Step 2: Manual verification checklist**

In Extension Development Host (`F5`):

- [ ] `Cmd+Shift+D` shows Quick-Pick with 5 templates
- [ ] Selecting "Freitext" starts recording
- [ ] Second `Cmd+Shift+D` stops and inserts cleaned text
- [ ] Next `Cmd+Shift+D` pre-selects "Freitext" in Quick-Pick
- [ ] Selecting "Commit Message" produces commit-format output
- [ ] Cancelling Quick-Pick (Escape) does not start recording
- [ ] Custom template added in settings.json appears in Quick-Pick
- [ ] Terminal dictation still works with template selection

**Step 3: Push and update PR**

```bash
git push origin feature/tf-248-prompt-templates
```

Update PR #6 from draft to ready, update title and description.
