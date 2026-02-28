export const STOPWORDS = new Set([
	'index', 'main', 'test', 'tests', 'spec', 'App', 'app',
	'constructor', 'prototype', 'toString', 'valueOf',
	'get', 'set', 'put', 'post', 'delete', 'patch',
	'true', 'false', 'null', 'undefined', 'void',
	'src', 'dist', 'out', 'build', 'lib', 'bin',
	'module', 'exports', 'require', 'import',
	'describe', 'suite', 'test', 'expect', 'assert',
	'setup', 'teardown', 'before', 'after',
]);

export function filterTerms(raw: string[], existingTerms: string[]): string[] {
	const existing = new Set(existingTerms);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const term of raw) {
		const trimmed = term.trim();
		if (trimmed.length < 3) { continue; }
		if (STOPWORDS.has(trimmed)) { continue; }
		if (existing.has(trimmed)) { continue; }
		if (seen.has(trimmed)) { continue; }
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result.sort((a, b) => a.localeCompare(b));
}

export class GlossaryGenerator {
	async generate(workspaceRoot: string, existingTerms: string[]): Promise<string[]> {
		return [];
	}
}
