import * as fs from 'fs';
import * as path from 'path';

// Lazy-load vscode module so pure functions remain testable outside the extension host.
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getVscode(): typeof import('vscode') { return require('vscode'); }

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

	static parseSymbols(content: string, language: 'ts' | 'java' | 'py' | string): string[] {
		const terms: string[] = [];
		let regex: RegExp;
		switch (language) {
			case 'ts':
				regex = /(?:export\s+)?(?:class|interface|enum|type|function)\s+(\w+)/g;
				break;
			case 'java':
				regex = /(?:public|private|protected)?\s*(?:class|interface|enum)\s+(\w+)/g;
				break;
			case 'py':
				regex = /^(?:class|def)\s+(\w+)/gm;
				break;
			default:
				return [];
		}
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const name = match[1];
			if (language === 'py' && name.startsWith('_')) { continue; }
			terms.push(name);
		}
		return terms;
	}

	static parseDocs(content: string): string[] {
		const terms: string[] = [];
		// Markdown headings h1-h3
		const headingRegex = /^#{1,3}\s+(.+)$/gm;
		let match: RegExpExecArray | null;
		while ((match = headingRegex.exec(content)) !== null) {
			terms.push(match[1]);
		}
		// Bold terms
		const boldRegex = /\*\*([^*]+)\*\*/g;
		while ((match = boldRegex.exec(content)) !== null) {
			terms.push(match[1]);
		}
		return terms;
	}

	async generate(workspaceRoot: string, existingTerms: string[]): Promise<string[]> {
		const rawTerms: string[] = [];

		// 1. Read metadata files from workspace root
		const metadataFiles: { file: string; parser: (content: string) => string[] }[] = [
			{ file: 'package.json', parser: GlossaryGenerator.parsePackageJson },
			{ file: 'pom.xml', parser: GlossaryGenerator.parsePomXml },
			{ file: 'pyproject.toml', parser: GlossaryGenerator.parsePyprojectToml },
		];

		for (const { file, parser } of metadataFiles) {
			try {
				const content = fs.readFileSync(path.join(workspaceRoot, file), 'utf-8');
				rawTerms.push(...parser(content));
			} catch {
				// File not found — skip silently
			}
		}

		// 2. Scan source files for symbols
		const excludePattern = '{**/node_modules/**,**/dist/**,**/out/**,**/.git/**,**/.verba/**,**/__pycache__/**,**/target/**,**/build/**}';
		const sourceFiles = await getVscode().workspace.findFiles('**/*.{ts,java,py}', excludePattern);

		for (const fileUri of sourceFiles) {
			try {
				const content = fs.readFileSync(fileUri.fsPath, 'utf-8');
				const ext = path.extname(fileUri.fsPath).slice(1); // 'ts', 'java', 'py'
				const language = ext === 'java' ? 'java' : ext === 'py' ? 'py' : 'ts';
				rawTerms.push(...GlossaryGenerator.parseSymbols(content, language));
			} catch {
				// Unreadable file — skip silently
			}
		}

		// 3. Read docs from workspace root
		const docFiles = ['README.md', 'CLAUDE.md'];
		for (const docFile of docFiles) {
			try {
				const content = fs.readFileSync(path.join(workspaceRoot, docFile), 'utf-8');
				rawTerms.push(...GlossaryGenerator.parseDocs(content));
			} catch {
				// File not found — skip silently
			}
		}

		// 4. Filter through filterTerms
		return filterTerms(rawTerms, existingTerms);
	}
}
