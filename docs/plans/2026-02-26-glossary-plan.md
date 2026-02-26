# Glossar/Dictionary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to define glossary terms that are preserved during Whisper transcription and Claude post-processing.

**Architecture:** Two-source glossary (VS Code settings + workspace file) merged at runtime. Terms are passed to Whisper as `prompt` parameter and injected into Claude system prompts as a dynamic instruction. Extension loads/watches both sources and passes the merged array to both services.

**Tech Stack:** TypeScript, VS Code Extension API (settings, FileSystemWatcher), OpenAI Whisper API (`prompt` param), Anthropic Claude API (system prompt injection)

---

### Task 1: Define `verba.glossary` setting in package.json

**Files:**
- Modify: `package.json:159-172` (add setting before `verba.contextSearch.maxResults`)

**Step 1: Add the setting definition**

In `package.json`, inside `contributes.configuration.properties`, add `verba.glossary` before `verba.contextSearch.maxResults`:

```json
"verba.glossary": {
  "type": "array",
  "default": [],
  "items": {
    "type": "string"
  },
  "description": "Terms that must be preserved exactly during transcription and cleanup (e.g. product names, technical terms). These terms are sent as hints to Whisper and as protection instructions to Claude. Limit: ~80 terms (224 Whisper prompt tokens)."
}
```

**Step 2: Verify TypeScript still compiles**

Run: `cd /Users/daniel/GitRepository/verba && npx tsc --noEmit`
Expected: No errors (package.json change is schema-only, no TS impact)

**Step 3: Commit**

```
git add package.json
git commit -m "feat: add verba.glossary setting definition"
```

---

### Task 2: Add glossary prompt parameter to TranscriptionService

**Files:**
- Modify: `src/transcriptionService.ts:27-36` (add `glossary` parameter to `process()`)
- Test: `src/test/unit/transcriptionService.test.ts`

**Step 1: Write the failing tests**

Add these tests inside the `process()` suite in `src/test/unit/transcriptionService.test.ts`:

```typescript
test('passes glossary terms as prompt parameter to Whisper', async () => {
    secretStorage.get.resolves('sk-test-key');
    fakeClient.audio.transcriptions.create.resolves({ text: 'Visual Studio Code is great' });
    sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

    await service.process('/tmp/test.wav', ['Visual Studio Code', 'Kubernetes']);

    const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
    assert.strictEqual(callArgs.prompt, 'Visual Studio Code, Kubernetes');
});

test('omits prompt parameter when glossary is empty', async () => {
    secretStorage.get.resolves('sk-test-key');
    fakeClient.audio.transcriptions.create.resolves({ text: 'Hello world' });
    sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

    await service.process('/tmp/test.wav', []);

    const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
    assert.strictEqual(callArgs.prompt, undefined);
});

test('omits prompt parameter when glossary is undefined', async () => {
    secretStorage.get.resolves('sk-test-key');
    fakeClient.audio.transcriptions.create.resolves({ text: 'Hello world' });
    sinon.stub(fs, 'createReadStream').returns('fake-stream' as any);

    await service.process('/tmp/test.wav');

    const callArgs = fakeClient.audio.transcriptions.create.firstCall.args[0];
    assert.strictEqual(callArgs.prompt, undefined);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/daniel/GitRepository/verba && npm run test:unit`
Expected: 3 new tests FAIL (process() doesn't accept glossary parameter yet)

**Step 3: Implement glossary parameter in TranscriptionService**

In `src/transcriptionService.ts`, modify the `process()` method signature and the Whisper API call:

Change `process(input: string)` to:
```typescript
async process(input: string, glossary?: string[]): Promise<string> {
```

Change the `client.audio.transcriptions.create` call to:
```typescript
const prompt = glossary?.length ? glossary.join(', ') : undefined;
transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(input),
    model: 'whisper-1',
    ...(prompt && { prompt }),
});
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/daniel/GitRepository/verba && npm run test:unit`
Expected: All tests PASS including the 3 new ones

**Step 5: Commit**

```
git add src/transcriptionService.ts src/test/unit/transcriptionService.test.ts
git commit -m "feat: add glossary prompt parameter to TranscriptionService"
```

---

### Task 3: Add dynamic glossary instruction to CleanupService

**Files:**
- Modify: `src/cleanupService.ts:38-45` (add glossary to constructor) and `src/cleanupService.ts:121-137` (modify `prepareRequest()`)
- Test: `src/test/unit/cleanupService.test.ts`

**Step 1: Write the failing tests**

Add these tests in `src/test/unit/cleanupService.test.ts`. Add them inside the `process()` suite:

```typescript
test('default system prompt includes glossary instruction when glossary is set', async () => {
    service.setGlossary(['Visual Studio Code', 'Kubernetes']);
    secretStorage.get.resolves('sk-ant-test-key');
    fakeClient.messages.create.resolves({
        content: [{ type: 'text', text: 'cleaned' }],
    });

    await service.process('test input');

    const callArgs = fakeClient.messages.create.firstCall.args[0];
    assert.ok(callArgs.system.includes('Visual Studio Code'),
        'system prompt should include glossary term');
    assert.ok(callArgs.system.includes('Kubernetes'),
        'system prompt should include glossary term');
});

test('default system prompt has no glossary instruction when glossary is empty', async () => {
    service.setGlossary([]);
    secretStorage.get.resolves('sk-ant-test-key');
    fakeClient.messages.create.resolves({
        content: [{ type: 'text', text: 'cleaned' }],
    });

    await service.process('test input');

    const callArgs = fakeClient.messages.create.firstCall.args[0];
    assert.ok(!callArgs.system.includes('exakt bei'),
        'system prompt should not include glossary instruction when empty');
});

test('template system prompt includes glossary instruction when glossary is set', async () => {
    service.setGlossary(['Spring Boot']);
    secretStorage.get.resolves('sk-ant-test-key');
    fakeClient.messages.create.resolves({
        content: [{ type: 'text', text: 'cleaned' }],
    });

    const context: PipelineContext = {
        templatePrompt: 'Convert to a commit message.',
    };
    await service.process('test input', context);

    const callArgs = fakeClient.messages.create.firstCall.args[0];
    assert.ok(callArgs.system.includes('Spring Boot'),
        'template prompt should include glossary term');
});
```

Add these inside the `processStreaming()` suite:

```typescript
test('streaming uses glossary in default prompt', async () => {
    service.setGlossary(['TypeScript']);
    secretStorage.get.resolves('sk-ant-test-key');
    fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

    await service.processStreaming('test input', undefined, sinon.stub());

    const callArgs = fakeClient.messages.stream.firstCall.args[0];
    assert.ok(callArgs.system.includes('TypeScript'),
        'streaming default prompt should include glossary term');
});

test('streaming uses glossary in template prompt', async () => {
    service.setGlossary(['Kubernetes']);
    secretStorage.get.resolves('sk-ant-test-key');
    fakeClient.messages.stream.returns(createFakeStream(['cleaned']));

    const context: PipelineContext = {
        templatePrompt: 'Convert to markdown.',
    };
    await service.processStreaming('test input', context, sinon.stub());

    const callArgs = fakeClient.messages.stream.firstCall.args[0];
    assert.ok(callArgs.system.includes('Kubernetes'),
        'streaming template prompt should include glossary term');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/daniel/GitRepository/verba && npm run test:unit`
Expected: 5 new tests FAIL (setGlossary doesn't exist yet)

**Step 3: Implement glossary in CleanupService**

In `src/cleanupService.ts`:

1. Add a `glossary` field and `setGlossary()` method to the class:

```typescript
private glossary: string[] = [];

setGlossary(terms: string[]): void {
    this.glossary = terms;
}
```

2. In `prepareRequest()`, build the glossary instruction dynamically and inject it into both prompt paths. Change the `systemPrompt` construction:

```typescript
const glossaryInstruction = this.glossary.length > 0
    ? ` Behalte folgende Begriffe exakt bei (nicht uebersetzen, nicht kuerzen, nicht aendern): ${this.glossary.join(', ')}.`
    : '';
const systemPrompt = context?.templatePrompt
    ? TEMPLATE_FRAMING + glossaryInstruction + '\n' + context.templatePrompt
    : CLEANUP_SYSTEM_PROMPT + glossaryInstruction;
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/daniel/GitRepository/verba && npm run test:unit`
Expected: All tests PASS including the 5 new ones

**Step 5: Commit**

```
git add src/cleanupService.ts src/test/unit/cleanupService.test.ts
git commit -m "feat: add dynamic glossary instruction to CleanupService"
```

---

### Task 4: Load and merge glossary in extension.ts

**Files:**
- Modify: `src/extension.ts:48-103` (add glossary loading, merging, watchers)

This task wires the glossary from both sources into the services. No unit tests for this task — it's integration wiring in `extension.ts` which is tested via integration tests and manual testing.

**Step 1: Add glossary loading function**

In `src/extension.ts`, inside `activate()`, after the `loadTemplates()` function (line 94), add:

```typescript
function loadGlossary(): string[] {
    const globalTerms = vscode.workspace
        .getConfiguration('verba')
        .get<string[]>('glossary', []);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let workspaceTerms: string[] = [];
    if (workspaceRoot) {
        const glossaryPath = path.join(workspaceRoot, '.verba-glossary.json');
        try {
            const content = fs.readFileSync(glossaryPath, 'utf-8');
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                workspaceTerms = parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
            }
        } catch (err: unknown) {
            if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[Verba] Failed to read .verba-glossary.json:', err);
            }
        }
    }

    // Workspace terms take priority (listed first), deduplicate
    const merged = [...new Set([...workspaceTerms, ...globalTerms])];
    return merged;
}
```

**Step 2: Initialize glossary and pass to services**

After the line `let processingAbortController: AbortController | null = null;` (line 56), add:

```typescript
function applyGlossary(): void {
    const terms = loadGlossary();
    cleanupService.setGlossary(terms);
    if (terms.length > 0) {
        console.log(`[Verba] Glossary loaded: ${terms.length} terms`);
    }
}
applyGlossary();
```

**Step 3: Pass glossary to transcription service in handleDictation**

In `handleDictation`, change the transcription call (line 130):

```typescript
const glossary = loadGlossary();
const rawTranscript = await transcriptionService.process(filePath, glossary);
```

**Step 4: Add FileSystemWatcher for .verba-glossary.json**

After the `saveWatcher` registration (around line 366), add:

```typescript
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
if (workspaceRoot) {
    const glossaryPattern = new vscode.RelativePattern(workspaceRoot, '.verba-glossary.json');
    const glossaryWatcher = vscode.workspace.createFileSystemWatcher(glossaryPattern);
    glossaryWatcher.onDidChange(() => applyGlossary());
    glossaryWatcher.onDidCreate(() => applyGlossary());
    glossaryWatcher.onDidDelete(() => applyGlossary());
    context.subscriptions.push(glossaryWatcher);
}
```

**Step 5: Add settings change listener for verba.glossary**

After the glossary watcher, add:

```typescript
const settingsWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('verba.glossary')) {
        applyGlossary();
    }
});
context.subscriptions.push(settingsWatcher);
```

**Step 6: Verify TypeScript compiles**

Run: `cd /Users/daniel/GitRepository/verba && npx tsc --noEmit`
Expected: No errors

**Step 7: Run all tests**

Run: `cd /Users/daniel/GitRepository/verba && npm run test:unit`
Expected: All tests PASS (existing + new glossary tests)

**Step 8: Commit**

```
git add src/extension.ts
git commit -m "feat: load and merge glossary from settings and workspace file"
```

---

### Task 5: Documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/guide/configuration.md`
- Modify: `docs/guide/templates.md`

**Step 1: Update CHANGELOG.md**

Add under the existing `## [Unreleased]` section (or create one):

```markdown
- **Glossary/Dictionary:** Define terms (product names, technical jargon) that are preserved exactly during transcription and cleanup. Global terms via `verba.glossary` setting, project-specific terms via `.verba-glossary.json`. Terms are sent as hints to Whisper and as protection instructions to Claude. Limit: ~80 terms.
```

**Step 2: Update CLAUDE.md**

In the `### Abgeschlossen` section, add:

```markdown
- **Glossar/Dictionary** - Done. Geschuetzte Begriffe bei Transkription (Whisper `prompt`-Parameter) und Bereinigung (Claude Prompt-Instruktion). Globale Begriffe via `verba.glossary` Setting, projektspezifische via `.verba-glossary.json`. `setGlossary()` auf CleanupService, `glossary`-Parameter auf TranscriptionService.
```

In the architecture table, update `cleanupService.ts` description:

```markdown
| `cleanupService.ts` | Anthropic Claude API Integration (Streaming + Course Correction + Voice Commands + Glossar) |
```

And update `transcriptionService.ts` description:

```markdown
| `transcriptionService.ts` | OpenAI Whisper API Integration (Glossar-Hints) |
```

**Step 3: Update README.md**

In the Features section, add a bullet:

```markdown
- **Glossary/Dictionary** -- Define terms that must be preserved exactly during transcription and cleanup (e.g. "Visual Studio Code", "Kubernetes"). Global terms in settings, project-specific terms in `.verba-glossary.json`.
```

In the Settings table, add:

```markdown
| `verba.glossary` | Array | `[]` | Terms preserved during transcription and cleanup (limit: ~80 terms) |
```

In the Architecture table, update `cleanupService.ts`:

```markdown
| `cleanupService.ts` | Anthropic Claude API integration (streaming, course correction, voice commands, glossary) |
```

And update `transcriptionService.ts`:

```markdown
| `transcriptionService.ts` | OpenAI Whisper API integration (glossary hints) |
```

**Step 4: Update docs/guide/configuration.md**

Add `verba.glossary` to the settings table and add a dedicated section:

```markdown
### Glossary

Define terms that must be preserved exactly during transcription and cleanup:

**Global terms** (all projects):
```json
"verba.glossary": ["Visual Studio Code", "Spring Boot", "Kubernetes"]
```

**Project-specific terms** (`.verba-glossary.json` in workspace root):
```json
["TalentFactory", "PipelineContext", "CleanupService"]
```

Both sources are merged at runtime (duplicates removed). Changes are detected automatically — no restart needed.

**Whisper prompt limit:** The glossary is sent to Whisper as a prompt hint (~224 tokens, roughly 80 terms). If exceeded, terms are truncated and a warning is logged.
```

**Step 5: Update docs/guide/templates.md**

Add a note about glossary interaction with templates:

```markdown
### Glossary Integration

Glossary terms are automatically included in all template prompts. Whether you use Freitext, Commit Message, or any custom template, protected terms will not be shortened, translated, or modified by Claude.

See [Configuration > Glossary](configuration.md#glossary) for setup instructions.
```

**Step 6: Commit**

```
git add CHANGELOG.md CLAUDE.md README.md docs/guide/configuration.md docs/guide/templates.md
git commit -m "docs: add Glossary/Dictionary feature documentation"
```

---

### Task 6: Update Roadmap

**Files:**
- Modify: `docs/ROADMAP.md`

**Step 1: Move Glossar from backlog to completed**

Remove the Glossar line from the Feature-Backlog table and add it to the Abgeschlossen table:

```markdown
| Glossar/Dictionary | Feb 2026 |
```

Renumber the remaining backlog items (Offline-Transkription becomes #1, Undo becomes #2, etc.).

**Step 2: Commit**

```
git add docs/ROADMAP.md
git commit -m "docs: move Glossar/Dictionary to completed in Roadmap"
```
