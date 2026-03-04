# On Windows with Cygwin make, the default /bin/sh cannot resolve npm/npx
# paths correctly due to Cygwin/Windows path conflicts. Route through cmd.exe.
ifeq ($(OS),Windows_NT)
  NPM := cmd.exe /c npm
  NPXC := cmd.exe /c npx
  CODE := cmd.exe /c code
else
  NPM := npm
  NPXC := npx
  CODE := code
endif

.PHONY: help dev compile watch test test-unit package install docs docs-serve

help: ## Show available targets
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  dev         Open extension in VS Code Extension Development Host"
	@echo "  compile     Compile TypeScript"
	@echo "  watch       Compile TypeScript in watch mode"
	@echo "  test        Run all tests (unit + integration)"
	@echo "  test-unit   Run unit tests only"
	@echo "  package     Package extension as .vsix"
	@echo "  install     Package and install extension locally"
	@echo "  docs        Build documentation (mkdocs)"
	@echo "  docs-serve  Serve documentation locally with live reload"
	@echo ""
	@echo "All targets are also available as npm scripts (cross-platform):"
	@echo "  npm run dev / compile / watch / test / test:unit / package:vsix / install:local"

dev:
	$(NPM) run dev

compile:
	$(NPM) run compile

watch:
	$(NPM) run watch

test:
	$(NPM) run test

test-unit:
	$(NPM) run test:unit

package:
	$(NPM) run package:vsix

install:
	$(NPM) run install:local

docs:
	mkdocs build --strict

docs-serve:
	mkdocs serve
