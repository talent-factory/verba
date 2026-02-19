.PHONY: dev compile watch

dev: compile
	code --extensionDevelopmentPath=$(CURDIR)

compile:
	npm run compile

watch:
	npm run watch
