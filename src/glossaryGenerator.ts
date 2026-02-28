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
	static parsePackageJson(content: string): string[] {
		try {
			const pkg = JSON.parse(content);
			const terms: string[] = [];
			if (pkg.name) { terms.push(pkg.name); }
			const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
			for (const dep of Object.keys(allDeps)) {
				if (dep.startsWith('@')) {
					const withoutScope = dep.slice(1);
					terms.push(withoutScope);
					const shortName = withoutScope.split('/').pop()!;
					terms.push(shortName);
				} else {
					terms.push(dep);
				}
			}
			return terms;
		} catch {
			return [];
		}
	}

	static parsePomXml(content: string): string[] {
		const terms: string[] = [];
		const artifactIdRegex = /<artifactId>([^<]+)<\/artifactId>/g;
		const groupIdRegex = /<groupId>([^<]+)<\/groupId>/g;
		let match: RegExpExecArray | null;
		while ((match = artifactIdRegex.exec(content)) !== null) {
			terms.push(match[1]);
		}
		while ((match = groupIdRegex.exec(content)) !== null) {
			terms.push(match[1]);
		}
		return terms;
	}

	static parsePyprojectToml(content: string): string[] {
		const terms: string[] = [];
		const nameMatch = /^name\s*=\s*"([^"]+)"/m.exec(content);
		if (nameMatch) { terms.push(nameMatch[1]); }
		const depRegex = /^\s*"([a-zA-Z0-9_-]+)(?:[>=<~!].*)?"/gm;
		let match: RegExpExecArray | null;
		while ((match = depRegex.exec(content)) !== null) {
			if (match[1] !== nameMatch?.[1]) {
				terms.push(match[1]);
			}
		}
		return terms;
	}

	async generate(workspaceRoot: string, existingTerms: string[]): Promise<string[]> {
		return [];
	}
}
