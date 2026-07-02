import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Scans the compiled package output (not the extension's node_modules copy) so a
// stray host import anywhere in @verba/core fails `npm run test:core` / CI,
// rather than relying on convention and code review alone.
const FORBIDDEN_MODULES = ['vscode', 'fs', 'child_process'];
const DIST_DIR = path.join(__dirname, '..', '..');

function listCompiledFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === 'test' ? [] : listCompiledFiles(fullPath);
		}
		return entry.name.endsWith('.js') ? [fullPath] : [];
	});
}

suite('core platform boundary', () => {
	test('never requires vscode or Node process/filesystem built-ins', () => {
		const requirePattern = /require\(["']([^"']+)["']\)/g;
		for (const file of listCompiledFiles(DIST_DIR)) {
			const content = fs.readFileSync(file, 'utf8');
			for (const match of content.matchAll(requirePattern)) {
				assert.ok(
					!FORBIDDEN_MODULES.includes(match[1]),
					`${path.relative(DIST_DIR, file)} requires '${match[1]}', which is forbidden in @verba/core — use an injected adapter instead`
				);
			}
		}
	});
});
