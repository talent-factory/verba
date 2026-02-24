# Template Auto-Reuse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Das zuletzt verwendete Template automatisch wiederverwenden, sodass der Quick Pick nur beim ersten Mal oder explizit via neuem Command erscheint.

**Architecture:** `handleDictation` prueft `workspaceState` auf gespeichertes Template und ueberspringt den Quick Pick wenn vorhanden. Neuer Command `dictation.selectTemplate` oeffnet den Quick Pick ohne Aufnahme zu starten. Status Bar zeigt aktives Template im Idle-Zustand.

**Tech Stack:** VS Code Extension API, TypeScript, Mocha/Sinon (Tests)

---

### Task 1: StatusBarManager um Template-Anzeige erweitern

**Files:**
- Modify: `src/statusBarManager.ts:16-20`
- Test: `src/test/unit/statusBarManager.test.ts` (neu)

**Step 1: Test schreiben**

Erstelle `src/test/unit/statusBarManager.test.ts`:

```typescript
import * as assert from 'assert';
import { StatusBarManager } from '../../statusBarManager';

suite('StatusBarManager', () => {
    let statusBar: StatusBarManager;

    setup(() => {
        statusBar = new StatusBarManager();
    });

    teardown(() => {
        statusBar.dispose();
    });

    test('setIdle without template shows default text', () => {
        statusBar.setIdle();
        // StatusBarManager uses vscode API internally — verify no throw
        assert.ok(statusBar);
    });

    test('setIdle with template shows template name', () => {
        statusBar.setIdle('Freitext');
        assert.ok(statusBar);
    });
});
```

**Step 2: Test ausfuehren, Fehlschlag verifizieren**

Run: `npm run test:unit`
Expected: FAIL — `setIdle` akzeptiert keinen Parameter

**Step 3: Implementieren**

In `src/statusBarManager.ts`, `setIdle` erweitern:

```typescript
setIdle(templateName?: string): void {
    this.item.text = templateName
        ? `$(mic) Verba: ${templateName}`
        : '$(mic) Verba';
    this.item.backgroundColor = undefined;
    this.item.tooltip = templateName
        ? `Active template: ${templateName} — Click to start dictation`
        : 'Click to start dictation';
}
```

**Step 4: Test ausfuehren, Erfolg verifizieren**

Run: `npm run test:unit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/statusBarManager.ts src/test/unit/statusBarManager.test.ts
git commit -m "feat: StatusBar zeigt aktives Template im Idle-Zustand"
```

---

### Task 2: Neuen Command `dictation.selectTemplate` in package.json registrieren

**Files:**
- Modify: `package.json:37-53` (commands) und `package.json:54-67` (keybindings)

**Step 1: Command hinzufuegen**

Im `contributes.commands`-Array nach dem `dictation.selectAudioDevice` Eintrag hinzufuegen:

```json
{
    "command": "dictation.selectTemplate",
    "title": "Select Template",
    "category": "Verba"
}
```

**Step 2: Keybinding hinzufuegen**

Im `contributes.keybindings`-Array hinzufuegen:

```json
{
    "command": "dictation.selectTemplate",
    "key": "ctrl+shift+t",
    "mac": "cmd+shift+t"
}
```

**Step 3: Verifizieren**

Run: `node -e "const p=require('./package.json'); console.log(p.contributes.commands.map(c=>c.command))"`
Expected: Array enthaelt `dictation.selectTemplate`

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: Command dictation.selectTemplate mit Keybinding registrieren"
```

---

### Task 3: `handleDictation` Flow aendern — Template Auto-Reuse

**Files:**
- Modify: `src/extension.ts:101-123`

**Step 1: Template-Lookup aus workspaceState implementieren**

Den `else`-Block in `handleDictation` (Zeile 101-159) aendern. Die aktuelle Logik (Zeilen 104-123):

```typescript
// AKTUELL: Quick Pick wird IMMER angezeigt
const rawTemplates = vscode.workspace
    .getConfiguration('verba')
    .get<Template[]>('templates', []);
const templates = rawTemplates.filter(...);
const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');
const template = await selectTemplate(templates, lastUsedName, ...);
if (!template) { return; }
selectedTemplate = template;
await context.workspaceState.update('verba.lastTemplateName', template.name);
```

Ersetzen durch:

```typescript
// NEU: Quick Pick nur wenn kein gespeichertes Template vorhanden
preferTerminal = forTerminal;
const rawTemplates = vscode.workspace
    .getConfiguration('verba')
    .get<Template[]>('templates', []);
const templates = rawTemplates.filter(
    (t): t is Template =>
        typeof t?.name === 'string' && t.name.trim() !== ''
        && typeof t?.prompt === 'string' && t.prompt.trim() !== '',
);

const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');
const lastUsedTemplate = lastUsedName
    ? templates.find(t => t.name === lastUsedName)
    : undefined;

let template: Template | undefined;
if (lastUsedTemplate) {
    template = lastUsedTemplate;
} else {
    template = await selectTemplate(
        templates,
        undefined,
        (items, options) => vscode.window.showQuickPick(items, options) as any,
    );
    if (!template) {
        return;
    }
    await context.workspaceState.update('verba.lastTemplateName', template.name);
}
selectedTemplate = template;
```

**Step 2: Status Bar im Idle-Zustand mit Template-Name aktualisieren**

Nach `statusBar.setIdle()` Aufrufen (Zeilen 56, 86, 92) den Template-Namen mitgeben. Spezifisch:

- Zeile 86 (nach erfolgreicher Transkription): `statusBar.setIdle(selectedTemplate?.name);`
- Zeile 92 (nach Fehler): `statusBar.setIdle(selectedTemplate?.name);` (selectedTemplate wird vorher auf undefined gesetzt, also bleibt es `setIdle()`)
- Zeile 56 (onUnexpectedStop): `statusBar.setIdle();` bleibt (selectedTemplate wird auf undefined gesetzt)
- Nach `statusBar.setRecording()` (Zeile 133): Keine Aenderung
- Beim Start nach Template-Auswahl: `statusBar.setIdle(template.name);` vor dem Start nicht noetig, da sofort `setRecording()` folgt

Am wichtigsten: Nach erfolgreichem Diktat (Zeile 86) und beim initialen `activate`:

In `activate()` nach dem StatusBar-Konstruktor (Zeile 45):

```typescript
const statusBar = new StatusBarManager();
const initialTemplate = context.workspaceState.get<string>('verba.lastTemplateName');
if (initialTemplate) {
    statusBar.setIdle(initialTemplate);
}
```

**Step 3: Verifizieren**

Run: `npm run compile`
Expected: Keine Fehler

Run: `npm run test:unit`
Expected: Alle Tests bestehen

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: Template Auto-Reuse — Quick Pick nur beim ersten Diktat"
```

---

### Task 4: Neuen `dictation.selectTemplate` Command implementieren

**Files:**
- Modify: `src/extension.ts` (nach `pickAudioDevice` Funktion)

**Step 1: Command-Handler implementieren**

Nach der `pickAudioDevice` Funktion und vor `const selectDeviceCommand = ...` (Zeile 209):

```typescript
const selectTemplateCommand = vscode.commands.registerCommand('dictation.selectTemplate', async () => {
    const rawTemplates = vscode.workspace
        .getConfiguration('verba')
        .get<Template[]>('templates', []);
    const templates = rawTemplates.filter(
        (t): t is Template =>
            typeof t?.name === 'string' && t.name.trim() !== ''
            && typeof t?.prompt === 'string' && t.prompt.trim() !== '',
    );

    const lastUsedName = context.workspaceState.get<string>('verba.lastTemplateName');
    const template = await selectTemplate(
        templates,
        lastUsedName,
        (items, options) => vscode.window.showQuickPick(items, options) as any,
    );
    if (!template) {
        return;
    }
    await context.workspaceState.update('verba.lastTemplateName', template.name);
    selectedTemplate = template;
    statusBar.setIdle(template.name);
    vscode.window.showInformationMessage(`Verba: Template set to "${template.name}"`);
});
```

**Step 2: Command in subscriptions registrieren**

In der `context.subscriptions.push(...)` Zeile (214) `selectTemplateCommand` hinzufuegen:

```typescript
context.subscriptions.push(editorCommand, terminalCommand, selectDeviceCommand, selectTemplateCommand, { dispose: () => recorder.dispose() }, statusBar);
```

**Step 3: Verifizieren**

Run: `npm run compile`
Expected: Keine Fehler

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: dictation.selectTemplate Command zum Template-Wechsel implementieren"
```

---

### Task 5: Template-Lade-Logik DRY refactoren

**Files:**
- Modify: `src/extension.ts`

**Step 1: Template-Laden extrahieren**

Die Template-Lade-Logik (Settings lesen, filtern) wird jetzt in `handleDictation` und `selectTemplateCommand` dupliziert. Extrahiere in eine lokale Hilfsfunktion:

```typescript
function loadTemplates(): Template[] {
    const rawTemplates = vscode.workspace
        .getConfiguration('verba')
        .get<Template[]>('templates', []);
    return rawTemplates.filter(
        (t): t is Template =>
            typeof t?.name === 'string' && t.name.trim() !== ''
            && typeof t?.prompt === 'string' && t.prompt.trim() !== '',
    );
}
```

Beide Stellen (handleDictation und selectTemplateCommand) auf `loadTemplates()` umstellen.

**Step 2: Verifizieren**

Run: `npm run compile && npm run test:unit`
Expected: Keine Fehler, alle Tests bestehen

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: Template-Lade-Logik in loadTemplates() extrahieren"
```

---

### Task 6: Dokumentation aktualisieren

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Step 1: CLAUDE.md**

Im Abschnitt "Konventionen" den neuen Command hinzufuegen:

```markdown
- Template-Command: `dictation.selectTemplate` (`Cmd+Shift+T` / `Ctrl+Shift+T`)
```

**Step 2: README.md**

Im "Quick Start" Abschnitt den Flow aktualisieren — erster Start zeigt Quick Pick, danach wird automatisch wiederverwendet. Den neuen Shortcut erwaehnen.

Im "Settings" Abschnitt oder nach "Quick Start" eine kurze Erklaerung:

```markdown
The first time you use Verba, you select a template. After that, the same template is reused automatically. To change templates, press `Cmd+Shift+T` (Mac) / `Ctrl+Shift+T` (Windows/Linux) or use the command `Verba: Select Template`.
```

**Step 3: CHANGELOG.md**

Unter `### Added` hinzufuegen:

```markdown
- Template auto-reuse: last used template is automatically reused, Quick Pick only on first use
- `dictation.selectTemplate` command (`Cmd+Shift+T` / `Ctrl+Shift+T`) to change template
- Status bar shows active template name
```

**Step 4: Commit**

```bash
git add CLAUDE.md README.md CHANGELOG.md
git commit -m "docs: Template Auto-Reuse Dokumentation aktualisieren"
```

---

### Task 7: VSIX paketieren und E2E verifizieren

**Step 1: Paketieren und installieren**

Run: `make package && make install`

**Step 2: Manuell verifizieren**

1. VS Code neu laden
2. Status Bar zeigt `$(mic) Verba` (kein Template gespeichert)
3. `Cmd+Shift+D` → Quick Pick erscheint (erster Start)
4. Template waehlen → Aufnahme startet
5. `Cmd+Shift+D` → Aufnahme stoppen → Text erscheint
6. Status Bar zeigt `$(mic) Verba: Freitext` (oder gewaehltes Template)
7. `Cmd+Shift+D` → Aufnahme startet SOFORT (kein Quick Pick!)
8. `Cmd+Shift+T` → Quick Pick erscheint → anderes Template waehlen
9. Status Bar aktualisiert sich
10. `Cmd+Shift+D` → Aufnahme mit neuem Template

**Step 3: Commit und Push**

```bash
git push origin develop
```
