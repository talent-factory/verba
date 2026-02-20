.PHONY: help dev compile watch test test-unit package install

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

dev: compile
	code --extensionDevelopmentPath=$(CURDIR)

compile:
	npm run compile

watch:
	npm run watch

test: compile
	npm run test:unit
	npm run test:integration

test-unit: compile
	npm run test:unit

package:
	npx @vscode/vsce package --allow-missing-repository

install: package
	code --install-extension verba-*.vsix
