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

/**
 * Parses grepai's `--json` output — an array of
 * `{file_path, start_line, end_line, score, content}` — into {@link SearchResult}s.
 * grepai's `content` starts with a redundant `File: <path>\n\n` header (its own),
 * which is stripped. Any parse failure (the human box format, non-array JSON)
 * yields no results. NOTE: grepai's default (non-`--json`) output is a formatted
 * box, NOT `file:line: content` — parsing that returned nothing, which is why
 * scope context was silently empty before `--json` was added to the CLI call.
 */
export function parseGrepaiOutput(output: string): SearchResult[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const results: SearchResult[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const rec = entry as Record<string, unknown>;
		const file = typeof rec.file_path === 'string' ? rec.file_path : undefined;
		if (!file) {
			continue;
		}
		const raw = typeof rec.content === 'string' ? rec.content : '';
		const header = `File: ${file}\n\n`;
		const content = raw.startsWith(header) ? raw.slice(header.length) : raw;
		results.push({ file, content });
	}
	return results;
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
		// `--json` = machine-readable output; `--` terminates flags so a query
		// starting with `-` can't be smuggled in as one (argv flag injection).
		const result = spawnSync('grepai', ['search', '--limit', String(topK), '--json', '--', query], {
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
