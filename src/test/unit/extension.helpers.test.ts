import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
	isTrustedDownloadHost, TRUSTED_DOWNLOAD_HOSTS, cleanupFile,
	isValidExpansion, mergeExpansions, mergeGlossary,
	parseGlossaryFile, parseExpansionsFile,
	WHISPER_MODELS, WHISPER_MODEL_BASE_URL,
} from '../../extensionHelpers';

suite('isTrustedDownloadHost', () => {
	test('accepts huggingface.co', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'),
			true,
		);
	});

	test('accepts cdn-lfs.huggingface.co', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://cdn-lfs.huggingface.co/repos/abc/def'),
			true,
		);
	});

	test('accepts cdn-lfs-us-1.huggingface.co', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://cdn-lfs-us-1.huggingface.co/some-path'),
			true,
		);
	});

	test('accepts cdn-lfs.hf.co', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://cdn-lfs.hf.co/some-path'),
			true,
		);
	});

	test('accepts subdomain of trusted host', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://us-east-1.cdn-lfs.huggingface.co/path'),
			true,
		);
	});

	test('rejects attacker domain', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://attacker.com/malicious-binary'),
			false,
		);
	});

	test('rejects domain that contains trusted host as substring but is not subdomain', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://evil-huggingface.co/path'),
			false,
		);
	});

	test('rejects domain that ends with trusted host but is not a subdomain', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://nothuggingface.co/path'),
			false,
		);
	});

	test('rejects empty string', () => {
		assert.strictEqual(isTrustedDownloadHost(''), false);
	});

	test('rejects invalid URL', () => {
		assert.strictEqual(isTrustedDownloadHost('not-a-url'), false);
	});

	test('rejects URL with trusted host in path but different domain', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://evil.com/huggingface.co/path'),
			false,
		);
	});

	test('rejects URL with trusted host as userinfo (@ bypass attack)', () => {
		assert.strictEqual(
			isTrustedDownloadHost('https://huggingface.co@evil.com/path'),
			false,
		);
	});

	test('TRUSTED_DOWNLOAD_HOSTS includes at least huggingface.co', () => {
		assert.ok(TRUSTED_DOWNLOAD_HOSTS.includes('huggingface.co'));
	});

	test('all trusted hosts are lowercase', () => {
		for (const host of TRUSTED_DOWNLOAD_HOSTS) {
			assert.strictEqual(host, host.toLowerCase(), `host "${host}" should be lowercase`);
		}
	});
});

suite('cleanupFile', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verba-cleanup-test-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('removes existing file', () => {
		const filePath = path.join(tmpDir, 'test.wav');
		fs.writeFileSync(filePath, 'dummy audio content');
		assert.ok(fs.existsSync(filePath));

		cleanupFile(filePath);

		assert.ok(!fs.existsSync(filePath), 'file should be deleted');
	});

	test('does not throw when file does not exist', () => {
		const filePath = path.join(tmpDir, 'nonexistent.wav');
		assert.doesNotThrow(() => cleanupFile(filePath));
	});

	test('does not throw on double-delete', () => {
		const filePath = path.join(tmpDir, 'test.wav');
		fs.writeFileSync(filePath, 'data');
		cleanupFile(filePath);
		assert.doesNotThrow(() => cleanupFile(filePath));
	});
});

suite('isValidExpansion', () => {
	test('accepts valid expansion', () => {
		assert.ok(isValidExpansion({ abbreviation: 'mfg', expansion: 'Mit freundlichen Gruessen' }));
	});

	test('rejects missing abbreviation', () => {
		assert.ok(!isValidExpansion({ expansion: 'text' }));
	});

	test('rejects missing expansion', () => {
		assert.ok(!isValidExpansion({ abbreviation: 'mfg' }));
	});

	test('rejects empty abbreviation', () => {
		assert.ok(!isValidExpansion({ abbreviation: '', expansion: 'text' }));
	});

	test('rejects whitespace-only abbreviation', () => {
		assert.ok(!isValidExpansion({ abbreviation: '   ', expansion: 'text' }));
	});

	test('rejects empty expansion', () => {
		assert.ok(!isValidExpansion({ abbreviation: 'mfg', expansion: '' }));
	});

	test('rejects whitespace-only expansion', () => {
		assert.ok(!isValidExpansion({ abbreviation: 'mfg', expansion: '   ' }));
	});

	test('rejects null', () => {
		assert.ok(!isValidExpansion(null));
	});

	test('rejects undefined', () => {
		assert.ok(!isValidExpansion(undefined));
	});

	test('rejects number', () => {
		assert.ok(!isValidExpansion(42));
	});

	test('rejects string', () => {
		assert.ok(!isValidExpansion('mfg'));
	});

	test('rejects object with numeric abbreviation', () => {
		assert.ok(!isValidExpansion({ abbreviation: 123, expansion: 'text' }));
	});
});

suite('mergeExpansions', () => {
	test('merges base and overrides', () => {
		const base = [{ abbreviation: 'mfg', expansion: 'global' }];
		const overrides = [{ abbreviation: 'vg', expansion: 'Viele Gruesse' }];
		const result = mergeExpansions(base, overrides);
		assert.strictEqual(result.length, 2);
	});

	test('overrides take precedence over base for same abbreviation', () => {
		const base = [{ abbreviation: 'mfg', expansion: 'global' }];
		const overrides = [{ abbreviation: 'MFG', expansion: 'workspace' }];
		const result = mergeExpansions(base, overrides);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].expansion, 'workspace');
	});

	test('lowercases abbreviation keys', () => {
		const result = mergeExpansions([{ abbreviation: 'MFG', expansion: 'text' }], []);
		assert.strictEqual(result[0].abbreviation, 'mfg');
	});

	test('returns empty array for empty inputs', () => {
		const result = mergeExpansions([], []);
		assert.strictEqual(result.length, 0);
	});
});

suite('mergeGlossary', () => {
	test('merges and deduplicates', () => {
		const result = mergeGlossary(['TypeScript', 'React'], ['React', 'Node']);
		assert.deepStrictEqual(result, ['TypeScript', 'React', 'Node']);
	});

	test('workspace terms listed first', () => {
		const result = mergeGlossary(['ws-term'], ['global-term']);
		assert.strictEqual(result[0], 'ws-term');
	});

	test('returns empty array for empty inputs', () => {
		assert.deepStrictEqual(mergeGlossary([], []), []);
	});
});

suite('parseGlossaryFile', () => {
	test('parses valid array of strings', () => {
		const result = parseGlossaryFile('["TypeScript", "React"]');
		assert.deepStrictEqual(result.terms, ['TypeScript', 'React']);
		assert.strictEqual(result.warning, undefined);
	});

	test('filters out non-string entries', () => {
		const result = parseGlossaryFile('[42, "valid", null, true, "also-valid"]');
		assert.deepStrictEqual(result.terms, ['valid', 'also-valid']);
	});

	test('filters out empty strings', () => {
		const result = parseGlossaryFile('["valid", "", "  "]');
		assert.deepStrictEqual(result.terms, ['valid']);
	});

	test('returns empty with warning for non-array JSON', () => {
		const result = parseGlossaryFile('{"not": "array"}');
		assert.deepStrictEqual(result.terms, []);
		assert.ok(result.warning, 'should include a warning');
		assert.ok(result.warning!.includes('array'), 'warning should mention array');
	});

	test('throws on invalid JSON', () => {
		assert.throws(() => parseGlossaryFile('not json'), /Unexpected token/);
	});
});

suite('parseExpansionsFile', () => {
	test('parses valid array of expansions', () => {
		const input = JSON.stringify([
			{ abbreviation: 'mfg', expansion: 'Mit freundlichen Gruessen' },
			{ abbreviation: 'vg', expansion: 'Viele Gruesse' },
		]);
		const { valid, skipped } = parseExpansionsFile(input);
		assert.strictEqual(valid.length, 2);
		assert.strictEqual(skipped, 0);
	});

	test('skips invalid entries and reports count', () => {
		const input = JSON.stringify([
			{ abbreviation: 'mfg', expansion: 'valid' },
			{ abbreviation: '', expansion: 'invalid' },
			{ not: 'expansion' },
		]);
		const { valid, skipped } = parseExpansionsFile(input);
		assert.strictEqual(valid.length, 1);
		assert.strictEqual(skipped, 2);
	});

	test('returns empty with warning for non-array JSON', () => {
		const result = parseExpansionsFile('{"abbreviation": "x"}');
		assert.strictEqual(result.valid.length, 0);
		assert.strictEqual(result.skipped, 0);
		assert.ok(result.warning, 'should include a warning for non-array input');
		assert.ok(result.warning!.includes('array'), 'warning should mention array');
	});

	test('throws on invalid JSON', () => {
		assert.throws(() => parseExpansionsFile('broken'), /Unexpected token/);
	});
});

suite('WHISPER_MODELS', () => {
	test('contains expected model names', () => {
		const names = WHISPER_MODELS.map(m => m.name);
		assert.ok(names.includes('tiny'));
		assert.ok(names.includes('base'));
		assert.ok(names.includes('small'));
		assert.ok(names.includes('medium'));
		assert.ok(names.includes('large-v3-turbo'));
	});

	test('all models have non-empty file and size', () => {
		for (const model of WHISPER_MODELS) {
			assert.ok(model.file.length > 0, `model ${model.name} has empty file`);
			assert.ok(model.size.length > 0, `model ${model.name} has empty size`);
			assert.ok(model.file.endsWith('.bin'), `model ${model.name} file should end with .bin`);
		}
	});

	test('WHISPER_MODEL_BASE_URL points to huggingface', () => {
		assert.ok(WHISPER_MODEL_BASE_URL.startsWith('https://huggingface.co/'));
	});
});
