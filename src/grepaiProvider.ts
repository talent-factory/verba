import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** A code snippet returned by a context search provider. */
export interface SearchResult {
	/** Relative file path of the matched source file. */
	file: string;
	/** Concatenated matching lines from the file. */
	content: string;
}

/** Parses grep-style `file:line: content` output into grouped {@link SearchResult}s. */
export function parseGrepaiOutput(output: string): SearchResult[] {
	const lines = output.split('\n').filter(l => l.trim());
	const grouped = new Map<string, string[]>();

	for (const line of lines) {
		const match = line.match(/^([^:]+):(\d+):\s*(.*)$/);
		if (match) {
			const file = match[1];
			const content = match[3];
			if (!grouped.has(file)) {
				grouped.set(file, []);
			}
			grouped.get(file)!.push(content);
		}
	}

	return Array.from(grouped.entries()).map(([file, contentLines]) => ({
		file,
		content: contentLines.join('\n'),
	}));
}

/**
 * Searches the codebase using the [grepai](https://yoanbernabeu.github.io/grepai/) CLI.
 * Requires `grepai` to be installed and initialized (`grepai init`) in the workspace.
 */
export class GrepaiProvider {
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/** Checks whether grepai CLI is installed and the workspace is initialized (`.grepai/` exists). */
	static isAvailable(workspaceRoot: string): boolean {
		// grepai must be installed AND initialized for this workspace (.grepai/ must exist)
		if (!fs.existsSync(path.join(workspaceRoot, '.grepai'))) {
			return false;
		}
		const cmd = process.platform === 'win32' ? 'where' : 'which';
		const result = spawnSync(cmd, ['grepai'], {
			encoding: 'utf-8',
			timeout: 5000,
			windowsHide: true,
		});
		return result.status === 0 && !result.error;
	}

	/** Runs a semantic search and returns the top-K matching code snippets. */
	search(query: string, topK: number): SearchResult[] {
		const result = spawnSync('grepai', ['search', query, '--limit', String(topK)], {
			encoding: 'utf-8',
			timeout: 30000,
			cwd: this.workspaceRoot,
			windowsHide: true,
		});

		if (result.error || result.status !== 0) {
			console.warn(`[Verba] grepai search failed: ${result.stderr || result.error?.message}`);
			return [];
		}

		return parseGrepaiOutput(result.stdout || '');
	}
}
