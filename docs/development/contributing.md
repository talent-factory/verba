# Contributing

Contributions to Verba are welcome. Here's how to get started.

## Development Setup

Verba is an npm-workspaces monorepo (`packages/core` + repo root + `apps/macos`)
with a [`justfile`](https://github.com/casey/just) wrapping the common
commands. See [Architecture](architecture.md) for how the packages relate.

```bash
# Clone the repository
git clone https://github.com/talent-factory/verba.git
cd verba

# Install all workspace dependencies (root + packages/core + apps/macos)
just install    # or: npm install

# Compile TypeScript (packages/core + the VS Code extension)
just compile

# Run unit tests
just test-unit

# Run all tests (compile + unit + integration)
just test
```

`just` (or `just --list`) shows every available recipe, grouped by target —
unprefixed recipes are the VS Code extension (primary product), `macos-*`
recipes are `apps/macos`, and `docs`/`docs-serve` build or preview this
documentation site.

## Development Commands

| Command | Description |
|---------|-------------|
| `just install` | Install all workspace dependencies |
| `just compile` | Compile TypeScript (`packages/core` + root) |
| `just watch` | Watch mode for TypeScript compilation |
| `just dev` | Compile and launch VS Code with the extension loaded |
| `just test` | Full test suite (compile + unit + integration) |
| `just test-unit` | Unit tests only (compile + Mocha + `@verba/core` tests) |
| `just package` | Build a `.vsix` package |
| `just install-local` | Build and install the extension locally into VS Code |
| `just macos-dev` | Run the macOS app — builds `@verba/core` first, then starts Tauri |
| `just macos-build` | Build the macOS app bundle (`.dmg`) — builds `@verba/core` first |
| `just docs` | Build the documentation site in strict mode (`mkdocs build --strict`) |
| `just docs-serve` | Serve the documentation site locally with live reload |

Each `macos-*` recipe depends on `compile-core` so it never runs against a
stale `@verba/core` build — see
[Architecture: hosts import `dist/`, not `src/`](architecture.md#hosts-import-dist-not-src)
for why that matters. If you change anything under `packages/core/src/`,
prefer these `just` recipes over calling the underlying `npm` scripts
directly in a host package.

## Git Workflow

- **`main`** is the stable release branch.
- **`develop`** is the integration branch.
- Feature branches: `feature/<issue-id>-<description>` (e.g., `feature/tf-250-terminal-dictation`).
- PRs always target `develop` — never `main` directly.
- When `develop` is merged into `main`, the release workflow automatically creates a git tag and GitHub Release.

## Commit Messages

Verba uses [Conventional Commits](https://www.conventionalcommits.org/) with optional emoji prefixes:

```
✨ feat: Add streaming support to pipeline
🐛 fix: Correct terminal focus detection on Windows
📚 docs: Update installation instructions
🔧 chore: Update dependencies
```

Maintainers create these via the `/git-workflow:commit` Claude Code skill,
which checks the diff and drafts a matching emoji-conventional message; feel
free to follow the same convention by hand.

## Documentation Changes

This site is built with [MkDocs](https://www.mkdocs.org/) (Material theme).
Before opening a PR that touches `docs/`, verify it builds cleanly in strict
mode — the same check CI runs:

```bash
just docs   # mkdocs build --strict
```

## Reporting Issues

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/talent-factory/verba/issues).
