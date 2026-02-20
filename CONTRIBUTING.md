# Contributing to Verba

Thank you for your interest in contributing to Verba. This document outlines the process for submitting changes and the standards we expect contributors to uphold.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/verba.git
   cd verba
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Compile and run tests** to verify your setup:
   ```bash
   npm run compile
   npm run test:unit
   ```

## Development Workflow

All contributions must be submitted through pull requests. Direct pushes to `main` and `develop` are restricted to project maintainers.

1. Create a feature branch from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/<short-description>
   ```
2. Make your changes in small, focused commits.
3. Ensure all tests pass before submitting:
   ```bash
   npm run test:unit
   ```
4. Push your branch and open a pull request targeting `develop`.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with emoji prefixes. Each commit message should follow this format:

```
<emoji> <type>: <description>
```

Common types:

| Emoji | Type | Use |
|-------|------|-----|
| ✨ | `feat` | New functionality |
| 🐛 | `fix` | Bug fix |
| 📚 | `docs` | Documentation |
| ♻️ | `refactor` | Code restructuring without behavioral change |
| 🧪 | `test` | Adding or correcting tests |
| 🔧 | `chore` | Build configuration, tooling, dependencies |

## Pull Request Guidelines

- Provide a clear title and description explaining the purpose of your changes.
- Reference any related issues (e.g., `Closes #12`).
- Keep pull requests focused on a single concern. Avoid bundling unrelated changes.
- Ensure the TypeScript compiler reports no errors and all unit tests pass.
- A project maintainer will review your pull request before it is merged.

## Code Standards

- **Language:** TypeScript in strict mode.
- **Platform:** VS Code Extension API. Follow the [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines).
- **Testing:** Unit tests use Mocha and Sinon. New functionality should include corresponding tests.
- **Style:** Consistent formatting with the existing codebase. No unused imports, no `any` types without justification.

## Reporting Issues

If you encounter a bug or have a feature suggestion, please [open an issue](https://github.com/talent-factory/verba/issues). Include sufficient detail to reproduce the problem or to evaluate the proposal.

## License

By contributing to Verba, you agree that your contributions will be licensed under the [MIT License](LICENSE).
