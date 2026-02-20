# Terminal Dictation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend `dictation.start` to insert dictated text into the active terminal when no text editor is focused.

**Architecture:** The existing `insertTextAtCursor()` function in `extension.ts` is extended with a terminal fallback: if no `activeTextEditor` exists, it checks for `activeTerminal` and uses `terminal.sendText()`. A new VS Code setting `verba.terminal.executeCommand` controls whether Enter is sent after the text. No pipeline changes needed.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.window.activeTerminal`, `Terminal.sendText()`), Mocha/Sinon (TDD-style: `suite`/`test`/`setup`/`teardown`)

---

### Task 1: Register `verba.terminal.executeCommand` setting

**Files:**
- Modify: `package.json:19-34`

**Step 1: Add contributes.configuration section**

In `package.json`, add a `configuration` block inside `contributes` (after the `keybindings` block, before the closing `}` of `contributes`):

```json
    "configuration": {
      "title": "Verba",
      "properties": {
        "verba.terminal.executeCommand": {
          "type": "boolean",
          "default": false,
          "description": "If true, sends Enter after inserting dictated text into the terminal (executes the text as a command)."
        }
      }
    }
```

The full `contributes` section should look like:

```json
  "contributes": {
    "commands": [
      {
        "command": "dictation.start",
        "title": "Toggle Dictation",
        "category": "Verba"
      }
    ],
    "keybindings": [
      {
        "command": "dictation.start",
        "key": "ctrl+shift+d",
        "mac": "cmd+shift+d"
      }
    ],
    "configuration": {
      "title": "Verba",
      "properties": {
        "verba.terminal.executeCommand": {
          "type": "boolean",
          "default": false,
          "description": "If true, sends Enter after inserting dictated text into the terminal (executes the text as a command)."
        }
      }
    }
  },
```

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: register verba.terminal.executeCommand setting (TF-250)"
```

---

### Task 2: Extend insertTextAtCursor with terminal support — TDD

**Files:**
- Modify: `src/extension.ts:31-44`
- Create: `src/test/unit/insertText.test.ts`

**Step 1: Write the failing tests**

Create `src/test/unit/insertText.test.ts`:

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';

import { insertText } from '../../extension';

suite('insertText', () => {
	teardown(() => {
		sinon.restore();
	});

	test('inserts text into active editor when available', async () => {
		const editStub = sinon.stub().resolves(true);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};

		await insertText('hello world', fakeEditor as any, undefined, false);

		assert.ok(editStub.calledOnce);
	});

	test('sends text to active terminal when no editor', async () => {
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('hello world', undefined, fakeTerminal as any, false);

		assert.ok(sendTextStub.calledOnce);
		assert.deepStrictEqual(sendTextStub.firstCall.args, ['hello world', false]);
	});

	test('sends text with addNewline=true when executeCommand is true', async () => {
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('ls -la', undefined, fakeTerminal as any, true);

		assert.deepStrictEqual(sendTextStub.firstCall.args, ['ls -la', true]);
	});

	test('throws when neither editor nor terminal is available', async () => {
		await assert.rejects(
			() => insertText('hello', undefined, undefined, false),
			/No active editor or terminal/
		);
	});

	test('throws when editor.edit returns false', async () => {
		const editStub = sinon.stub().resolves(false);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};

		await assert.rejects(
			() => insertText('hello', fakeEditor as any, undefined, false),
			/Failed to insert transcription/
		);
	});

	test('prefers editor over terminal when both are available', async () => {
		const editStub = sinon.stub().resolves(true);
		const fakeEditor = {
			selection: { active: { line: 0, character: 0 } },
			edit: editStub,
		};
		const sendTextStub = sinon.stub();
		const fakeTerminal = { sendText: sendTextStub };

		await insertText('hello', fakeEditor as any, fakeTerminal as any, false);

		assert.ok(editStub.calledOnce, 'editor.edit should be called');
		assert.ok(sendTextStub.notCalled, 'terminal.sendText should not be called');
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run compile 2>&1; npm run test:unit 2>&1`
Expected: Compilation error — `insertText` is not exported from `extension.ts`.

**Step 3: Refactor insertTextAtCursor into exported insertText**

In `src/extension.ts`, replace the `insertTextAtCursor` function (lines 31-44) with an exported `insertText` function that accepts dependencies as parameters for testability:

```typescript
export async function insertText(
	text: string,
	editor: vscode.TextEditor | undefined,
	terminal: vscode.Terminal | undefined,
	executeCommand: boolean,
): Promise<void> {
	if (editor) {
		const success = await editor.edit((editBuilder) => {
			editBuilder.insert(editor.selection.active, text);
		});
		if (!success) {
			throw new Error(
				'Failed to insert transcription — the editor may have been closed or the document changed.'
			);
		}
		return;
	}

	if (terminal) {
		terminal.sendText(text, executeCommand);
		return;
	}

	throw new Error('No active editor or terminal. Open a file or terminal before dictating.');
}
```

Then update the call site in `activate()` (around line 80) — replace:

```typescript
await insertTextAtCursor(transcript);
```

with:

```typescript
const executeCommand = vscode.workspace.getConfiguration('verba.terminal').get<boolean>('executeCommand', false);
await insertText(
	transcript,
	vscode.window.activeTextEditor,
	vscode.window.activeTerminal,
	executeCommand,
);
```

**Step 4: Run tests to verify they pass**

Run: `npm run compile && npm run test:unit`
Expected: All tests passing (47 existing + 6 new = 53 total)

**Step 5: Commit**

```bash
git add src/extension.ts src/test/unit/insertText.test.ts
git commit -m "feat: extend text insertion to support active terminal (TF-250)"
```

---

### Task 3: Final verification and push

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `npm run compile && npm run test:unit`
Expected: 53 passing

**Step 2: Verify the insertText logic**

Check that `extension.ts` has:
1. `insertText()` exported with editor/terminal/executeCommand parameters
2. Editor takes priority over terminal
3. Setting `verba.terminal.executeCommand` is read from workspace configuration at the call site

**Step 3: Push to remote**

Run: `git push origin feature/tf-250-terminal-dictation`

**Step 4: Mark PR as ready for review**

Run: `gh pr ready <PR-number>`

**Step 5: Update Linear TF-250 to "In Review"**

Use Linear MCP: `update_issue(id: "TF-250", state: "In Review")`
