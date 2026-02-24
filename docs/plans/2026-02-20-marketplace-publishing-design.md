# Verba Marketplace Publishing Design

**Datum:** 2026-02-20
**Status:** Genehmigt

## Ziel

Verba auf dem offiziellen VS Code Marketplace veroeffentlichen mit automatisiertem Release-Workflow: Merge von develop nach main loest automatisch ein neues Release aus.

## Entscheidungen

| Thema | Entscheidung | Begruendung |
|-------|-------------|-------------|
| Publisher | `talent-factory` | Organisationsname, muss auf marketplace.visualstudio.com erstellt werden |
| Lizenz | MIT | Maximale Adoption, Monetarisierung spaeter ueber Premium-Features |
| Initiale Version | 0.1.0 | Signalisiert "fruehe oeffentliche Version" |
| Icon | PNG in `images/icon.png` | Marketplace erfordert PNG (128x128 oder 256x256), konvertiert aus vorhandenem SVG |
| README-Sprache | Englisch | Internationale Zielgruppe, maximale Reichweite |
| Versioning | semantic-release mit Conventional Commits | Automatisches Versioning, CHANGELOG-Generierung |
| CI/CD | GitHub Actions auf Push nach main | Vollautomatischer Release-Workflow |
| Commit-Format | Emoji + Conventional Commits | Custom Parser unterstuetzt beide Formate |

## package.json Aenderungen

Folgende Felder werden ergaenzt oder geaendert:

```json
{
  "version": "0.1.0",
  "license": "MIT",
  "icon": "images/icon.png",
  "galleryBanner": {
    "color": "#1e1e1e",
    "theme": "dark"
  },
  "keywords": ["dictation", "voice", "whisper", "speech-to-text", "ai"],
  "categories": ["Other", "Machine Learning"],
  "homepage": "https://github.com/talent-factory/verba",
  "bugs": {
    "url": "https://github.com/talent-factory/verba/issues"
  }
}
```

Neue Dev-Dependencies:
- `semantic-release`
- `@semantic-release/changelog`
- `@semantic-release/git`
- `semantic-release-vsce`

## Neue Dateien

### LICENSE (MIT)

Standard MIT-Lizenztext mit Copyright talent-factory, 2026.

### CHANGELOG.md

Initiale Struktur, wird von semantic-release automatisch gepflegt:

```markdown
# Changelog

All notable changes to this project will be documented in this file.
```

### .releaserc.json

semantic-release Konfiguration mit Custom Parser fuer Emoji-Commits:

```json
{
  "branches": ["main"],
  "plugins": [
    ["@semantic-release/commit-analyzer", {
      "preset": "conventionalcommits",
      "parserOpts": {
        "headerPattern": "^(?:.*?\\s)?([a-zA-Z]+)(?:\\(([^)]+)\\))?!?:\\s(.+)$",
        "headerCorrespondence": ["type", "scope", "subject"]
      }
    }],
    ["@semantic-release/release-notes-generator", {
      "preset": "conventionalcommits",
      "parserOpts": {
        "headerPattern": "^(?:.*?\\s)?([a-zA-Z]+)(?:\\(([^)]+)\\))?!?:\\s(.+)$",
        "headerCorrespondence": ["type", "scope", "subject"]
      }
    }],
    "@semantic-release/changelog",
    ["semantic-release-vsce", {
      "packageVsix": true
    }],
    ["@semantic-release/github", {
      "assets": [{"path": "*.vsix"}]
    }],
    ["@semantic-release/git", {
      "assets": ["CHANGELOG.md", "package.json"],
      "message": "chore(release): ${nextRelease.version}\n\n${nextRelease.notes}"
    }]
  ]
}
```

### .github/workflows/release.yml

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run compile
      - run: npm run test:unit
      - name: Semantic Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
        run: npx semantic-release
```

### .vscodeignore (Erweiterung)

Zusaetzliche Eintraege:

```
.worktrees/**
docs/**
test-workspace/**
.grepai/**
CLAUDE.md
.mocharc.yml
*.vsix
.github/**
.releaserc.json
```

## README.md (Englisch)

Komplette Neuschreibung auf Englisch mit Marketplace-optimierter Struktur:

1. Header mit Name, Tagline, Badges
2. Hero-Beschreibung
3. Features
4. Prerequisites (ffmpeg, API Keys)
5. Installation (Marketplace + CLI)
6. Quick Start (5 Schritte)
7. Configuration (Templates, Settings)
8. Architecture
9. Contributing
10. License

## Release-Workflow

```
develop -> PR nach main -> Merge -> GitHub Action -> Tests -> semantic-release -> Marketplace
```

semantic-release liest die Commits seit dem letzten Release und bestimmt automatisch:
- `fix:` -> Patch-Release (0.1.0 -> 0.1.1)
- `feat:` -> Minor-Release (0.1.0 -> 0.2.0)
- `BREAKING CHANGE:` -> Major-Release (0.1.0 -> 1.0.0)

## Manuelle Einmal-Schritte

1. Publisher-Account auf marketplace.visualstudio.com erstellen
2. Azure DevOps PAT generieren (Scope: Marketplace Manage)
3. PAT als `VSCE_PAT` in GitHub Repository Secrets hinterlegen
4. SVG-Icon zu PNG konvertieren (256x256) und in `images/icon.png` ablegen
