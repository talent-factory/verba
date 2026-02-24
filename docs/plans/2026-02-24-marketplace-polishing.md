# Marketplace-Polishing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** VS Code Extension-Detailseite aufwerten: Changelog-Tab sichtbar, Screenshots eingebettet, Badges/Kategorien poliert.

**Architecture:** Config-Aenderungen (.vscodeignore, package.json), README-Edits mit Bild-Referenzen, Screenshot-Platzhalter. Keine Code-Aenderungen.

**Tech Stack:** VS Code Extension Manifest, Markdown, vsce

---

### Task 1: Changelog ins VSIX-Paket aufnehmen

**Files:**
- Modify: `.vscodeignore:17` (Zeile entfernen)

**Step 1: CHANGELOG.md aus .vscodeignore entfernen**

Zeile `CHANGELOG.md` aus `.vscodeignore` loeschen.

**Step 2: Verifizieren**

Run: `npx @vscode/vsce ls --allow-missing-repository | grep -i changelog`
Expected: `extension/CHANGELOG.md` in der Ausgabe

**Step 3: Commit**

```bash
git add .vscodeignore
git commit -m "fix: CHANGELOG.md ins VSIX-Paket aufnehmen fuer Changelog-Tab"
```

---

### Task 2: Screenshot-Verzeichnis erstellen

**Files:**
- Create: `images/screenshots/.gitkeep`

**Step 1: Verzeichnis anlegen**

```bash
mkdir -p images/screenshots
touch images/screenshots/.gitkeep
```

**Step 2: Commit**

```bash
git add images/screenshots/.gitkeep
git commit -m "chore: Screenshot-Verzeichnis fuer Marketplace-Bilder anlegen"
```

---

### Task 3: Kategorien aktualisieren

**Files:**
- Modify: `package.json:31-34`

**Step 1: Kategorie aendern**

In `package.json`, `"Other"` durch `"Snippets"` ersetzen im `categories`-Array:

```json
"categories": [
  "Snippets",
  "Machine Learning"
],
```

**Step 2: Verifizieren**

Run: `node -e "const p=require('./package.json'); console.log(p.categories)"`
Expected: `[ 'Snippets', 'Machine Learning' ]`

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: Kategorie 'Other' durch 'Snippets' ersetzen fuer bessere Marketplace-Auffindbarkeit"
```

---

### Task 4: README mit Screenshot-Platzhaltern erweitern

**Files:**
- Modify: `README.md`

**Step 1: Hero-GIF unter Features einfuegen**

Nach `## Features` und vor der Feature-Liste einfuegen:

```markdown
<p align="center">
  <img src="images/screenshots/dictation-workflow.gif" alt="Verba Dictation Workflow" width="800">
</p>
```

**Step 2: Template-Picker Screenshot bei Quick Start einfuegen**

Nach Zeile `1. \`Cmd+Shift+D\` -- Quick Pick with template selection appears` einfuegen:

```markdown
<p align="center">
  <img src="images/screenshots/template-picker.png" alt="Template Quick Pick" width="600">
</p>
```

**Step 3: Audio Device Screenshot bei Platform-Specific Notes einfuegen**

Nach der Platform-Tabelle und dem Erklaerungstext einfuegen:

```markdown
<p align="center">
  <img src="images/screenshots/audio-device-selection.png" alt="Audio Device Selection" width="600">
</p>
```

**Step 4: Terminal-Mode Screenshot einfuegen**

Nach dem Terminal Mode Erklaerungstext einfuegen:

```markdown
<p align="center">
  <img src="images/screenshots/terminal-mode.png" alt="Terminal Mode" width="600">
</p>
```

**Step 5: Installs-Badge ergaenzen**

Im Badge-Block nach dem Marketplace-Version-Badge einfuegen:

```html
<a href="https://marketplace.visualstudio.com/items?itemName=talent-factory.verba"><img src="https://img.shields.io/visual-studio-marketplace/i/talent-factory.verba" alt="Installs"></a>
```

**Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README mit Screenshot-Platzhaltern und Installs-Badge erweitern"
```

---

### Task 5: Screenshots aufnehmen und einfuegen

**Files:**
- Create: `images/screenshots/template-picker.png`
- Create: `images/screenshots/dictation-workflow.gif`
- Create: `images/screenshots/audio-device-selection.png`
- Create: `images/screenshots/terminal-mode.png`
- Create: `images/screenshots/status-bar.png`
- Remove: `images/screenshots/.gitkeep`

**Step 1: Screenshots manuell aufnehmen**

MANUELL durch den User. Anleitung:

1. **template-picker.png**: `Cmd+Shift+D` → Quick Pick sichtbar → `Cmd+Shift+4` (macOS Screenshot)
2. **dictation-workflow.gif**: GIF-Tool (z.B. Kap, CleanShot) → Shortcut → Template → Sprechen → Text erscheint (~5-10s, 800px breit)
3. **audio-device-selection.png**: `Cmd+Shift+P` → "Verba: Select Audio Device" → Quick Pick sichtbar → Screenshot
4. **terminal-mode.png**: Terminal fokussieren → diktieren → Text im Terminal → Screenshot
5. **status-bar.png**: Drei Zustaende (Idle/Recording/Transcribing) einzeln croppen oder nebeneinander montieren

Bilder in `images/screenshots/` ablegen.

**Step 2: .gitkeep entfernen und Bilder committen**

```bash
rm images/screenshots/.gitkeep
git add images/screenshots/
git commit -m "feat: Marketplace-Screenshots hinzufuegen"
```

---

### Task 6: VSIX paketieren und verifizieren

**Files:** Keine Aenderungen, nur Verifikation

**Step 1: Paketieren**

Run: `make package`
Expected: VSIX enthaelt CHANGELOG.md und images/screenshots/

**Step 2: Paketinhalt pruefen**

Run: `npx @vscode/vsce ls --allow-missing-repository`
Expected: CHANGELOG.md, alle Screenshots, README.md in der Liste

**Step 3: Installieren und visuell pruefen**

Run: `make install`
→ VS Code neu laden
→ Extension-Detailseite oeffnen
→ DETAILS-Tab: Screenshots sichtbar
→ CHANGELOG-Tab: Changelog sichtbar

---

### Task 7: Abschluss-Commit und Push

**Step 1: Finalen Stand pushen**

```bash
git push origin develop
```
