import * as assert from 'assert';

import { filterTerms, STOPWORDS, GlossaryGenerator } from '../../glossaryGenerator';

suite('filterTerms', () => {
	test('removes terms shorter than 3 characters', () => {
		const result = filterTerms(['ab', 'cd', 'TypeScript', 'Go'], []);
		assert.deepStrictEqual(result, ['TypeScript']);
	});

	test('removes stopwords', () => {
		const result = filterTerms(['constructor', 'Verba', 'module', 'Pipeline'], []);
		assert.deepStrictEqual(result, ['Pipeline', 'Verba']);
	});

	test('removes already existing glossary terms', () => {
		const result = filterTerms(['Verba', 'Claude', 'Whisper'], ['Claude']);
		assert.deepStrictEqual(result, ['Verba', 'Whisper']);
	});

	test('deduplicates terms', () => {
		const result = filterTerms(['Verba', 'Claude', 'Verba', 'Claude'], []);
		assert.deepStrictEqual(result, ['Claude', 'Verba']);
	});

	test('sorts alphabetically', () => {
		const result = filterTerms(['Zebra', 'Alpha', 'Mango'], []);
		assert.deepStrictEqual(result, ['Alpha', 'Mango', 'Zebra']);
	});

	test('returns empty array for all-filtered input', () => {
		const result = filterTerms(['ab', 'constructor', 'module'], []);
		assert.deepStrictEqual(result, []);
	});
});

suite('GlossaryGenerator.parsePackageJson', () => {
	test('extracts project name and dependency names', () => {
		const pkg = JSON.stringify({
			name: 'verba',
			dependencies: { 'openai': '^4.0.0', 'express': '^4.18.0' },
			devDependencies: { 'mocha': '^10.0.0' },
		});
		const result = GlossaryGenerator.parsePackageJson(pkg);
		assert.ok(result.includes('verba'));
		assert.ok(result.includes('openai'));
		assert.ok(result.includes('express'));
		assert.ok(result.includes('mocha'));
	});

	test('extracts unscoped name from scoped packages', () => {
		const pkg = JSON.stringify({
			name: 'test-app',
			dependencies: { '@anthropic-ai/sdk': '^1.0.0', '@types/sinon': '^10.0.0' },
		});
		const result = GlossaryGenerator.parsePackageJson(pkg);
		assert.ok(result.includes('anthropic-ai/sdk'));
		assert.ok(result.includes('sdk'));
		assert.ok(result.includes('sinon'));
	});

	test('handles invalid JSON gracefully', () => {
		const result = GlossaryGenerator.parsePackageJson('not valid json{{{');
		assert.deepStrictEqual(result, []);
	});
});

suite('GlossaryGenerator.parsePomXml', () => {
	test('extracts artifactId and groupId values', () => {
		const pom = `
			<project>
				<groupId>com.example</groupId>
				<artifactId>my-service</artifactId>
				<dependencies>
					<dependency>
						<groupId>org.springframework</groupId>
						<artifactId>spring-core</artifactId>
					</dependency>
				</dependencies>
			</project>`;
		const result = GlossaryGenerator.parsePomXml(pom);
		assert.ok(result.includes('com.example'));
		assert.ok(result.includes('my-service'));
		assert.ok(result.includes('org.springframework'));
		assert.ok(result.includes('spring-core'));
	});

	test('handles no matches', () => {
		const result = GlossaryGenerator.parsePomXml('<project></project>');
		assert.deepStrictEqual(result, []);
	});
});

suite('GlossaryGenerator.parsePyprojectToml', () => {
	test('extracts project name and dependency names', () => {
		const toml = `
[project]
name = "my-package"
dependencies = [
    "requests>=2.28.0",
    "click",
    "pydantic~=1.10",
]`;
		const result = GlossaryGenerator.parsePyprojectToml(toml);
		assert.ok(result.includes('my-package'));
		assert.ok(result.includes('requests'));
		assert.ok(result.includes('click'));
		assert.ok(result.includes('pydantic'));
	});

	test('handles no matches', () => {
		const result = GlossaryGenerator.parsePyprojectToml('[tool.ruff]\nline-length = 88');
		assert.deepStrictEqual(result, []);
	});
});
