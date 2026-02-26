# Contributing

Contributions to Verba are welcome. Here's how to get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/talent-factory/verba.git
cd verba

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run unit tests
npm run test:unit

# Run all tests (compile + unit + integration)
npm run test
```

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript to `out/` |
| `npm run bundle` | Bundle with esbuild to `dist/extension.js` |
| `npm run watch` | Watch mode for TypeScript compilation |
| `npm run dev` | Compile and launch VS Code with the extension loaded |
| `npm run test:unit` | Run unit tests with Mocha |
| `npm run test:integration` | Run integration tests in VS Code host |
| `npm run test` | Compile + unit tests + integration tests |
| `npm run package:vsix` | Build a `.vsix` package |
| `npm run install:local` | Build and install the extension locally |

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

## Reporting Issues

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/talent-factory/verba/issues).
