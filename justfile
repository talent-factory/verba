# justfile — verba task runner
#
# Run `just` (or `just --list`) to see all recipes.
# Stack: VS Code extension (TypeScript, npm workspaces) in the repo root +
# `packages/core` · `apps/macos`: Tauri menu-bar app skeleton (M1, macOS only).
#
# Convention: unprefixed recipes = VS Code extension (primary product).
# `macos-*` = apps/macos Tauri app.

# Default — show available recipes
default:
	@just --list

# ─── Setup ────────────────────────────────────────────────────────────────────

# Install all workspace dependencies (root + packages/core + apps/macos)
[group('setup')]
install:
	npm install

# ─── Extension (VS Code) ──────────────────────────────────────────────────────

# Compile and open the extension in a new VS Code Extension Development Host
[group('extension')]
dev:
	npm run dev

# Compile TypeScript (packages/core + root)
[group('extension')]
compile:
	npm run compile

# Compile TypeScript in watch mode
[group('extension')]
watch:
	npm run watch

# Run the full test suite (compile + unit + integration)
[group('extension')]
test:
	npm run test

# Run unit tests only (compile + mocha + @verba/core tests)
[group('extension')]
test-unit:
	npm run test:unit

# Package the extension as a .vsix
[group('extension')]
package:
	npm run package:vsix

# Package and install the extension locally into VS Code
[group('extension')]
install-local:
	npm run install:local

# ─── macOS app (Tauri, M1 skeleton) ────────────────────────────────────────────
# apps/macos — reuses @verba/core; build not yet verified in CI (see apps/macos/README.md).

# The macOS app imports @verba/core's COMPILED output (package "main" →
# dist/index.js), not src/, and `tauri dev`/`build` do not rebuild it. Every
# macos-* recipe depends on this so they never run against a stale dist (which
# manifests as e.g. a dead hotkey after @verba/core changed).
#
# Compile @verba/core to dist/ (macOS app imports the built output, not src/)
[group('macos')]
compile-core:
	npm run compile:core

# Run the native app (builds @verba/core, starts vite, launches Tauri)
[group('macos')]
macos-dev: compile-core
	cd apps/macos && npm run tauri dev

# Build the native app bundle (.dmg)
[group('macos')]
macos-build: compile-core
	cd apps/macos && npm run tauri build

# Type-check the macOS frontend against @verba/core
[group('macos')]
macos-typecheck: compile-core
	cd apps/macos && npm run typecheck

# ─── Coverage ─────────────────────────────────────────────────────────────────

# Coverage for @verba/core (c8; gate ≥90% lines/functions/statements, ≥85% branches).
[group('coverage')]
coverage-core:
	npm --workspace @verba/core run test:coverage

# Coverage for the VS Code extension logic (c8; gate ≥90% lines/functions/statements,
# ≥85% branches). Excludes the entry point, WebView panels and ffmpeg/status-bar
# glue — those are exercised by the integration suite and manual UAT, not unit tests.
[group('coverage')]
coverage-vscode: compile-core
	npm run test:coverage

# Coverage for the macOS TS host logic (c8; same gate). Excludes Tauri/DOM glue
# (main, wiring, ui, hud and the thin IPC-wrapper adapters).
[group('coverage')]
coverage-macos: compile-core
	npm --workspace @verba/macos run test:coverage

# Coverage for the macOS Rust backend (cargo-llvm-cov). Pure-FFI files
# (cpal / Tauri window·menu·tray·store / keyring) are ignored — they are verified
# by UAT, not unit tests. Reports decision-logic coverage; no hard gate, because
# Rust interleaves logic with FFI in the same files (a 90% line gate would need a
# logic/FFI split first). The pure logic (classify, herdr/config parsing, query
# params, URL allow-list, clipboard sequencing) is unit-tested.
[group('coverage')]
coverage-rust:
	cd apps/macos/src-tauri && cargo llvm-cov --ignore-filename-regex '(audio|hud|lib|main|secret|store|menu|tray)\.rs$'

# Run every coverage suite (TS gates enforced; Rust is report-only).
[group('coverage')]
coverage: coverage-core coverage-vscode coverage-macos coverage-rust

# ─── Docs ───────────────────────────────────────────────────────────────────────

# Build documentation (mkdocs, strict mode)
[group('docs')]
docs:
	mkdocs build --strict

# Serve documentation locally with live reload
[group('docs')]
docs-serve:
	mkdocs serve

# ─── Clean ────────────────────────────────────────────────────────────────────

# Remove all build artifacts (extension, core, macOS, docs) — keeps node_modules.
# Note: also drops apps/macos/src-tauri/target, so the next macos-* triggers a
# full Rust rebuild (slow). Dependencies stay; no re-install needed.
[group('clean')]
clean:
	rm -rf out dist dist-test .vscode-test site *.vsix
	rm -rf packages/core/dist
	rm -rf apps/macos/dist apps/macos/src-tauri/target

# Full reset — also remove every node_modules. Re-run `just install` afterwards.
[group('clean')]
clean-all: clean
	rm -rf node_modules packages/core/node_modules apps/macos/node_modules
