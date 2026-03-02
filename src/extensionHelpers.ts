import * as fs from 'fs';
import { Expansion } from './cleanupService';

/** Trusted hosts for model download redirects (Hugging Face CDN). */
export const TRUSTED_DOWNLOAD_HOSTS = [
	'huggingface.co',
	'cdn-lfs.huggingface.co',
	'cdn-lfs-us-1.huggingface.co',
	'cdn-lfs.hf.co',
];

/** Checks whether a URL points to a trusted download host (Hugging Face CDN). */
export function isTrustedDownloadHost(urlString: string): boolean {
	try {
		const { hostname } = new URL(urlString);
		return TRUSTED_DOWNLOAD_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
	} catch {
		return false;
	}
}

/** Silently removes a file if it exists. Logs errors for non-ENOENT failures. */
export function cleanupFile(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch (err: unknown) {
		if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
			console.error('[Verba] Failed to clean up temp file:', err);
		}
	}
}

/** Validates that a value is a well-formed Expansion with non-empty strings. */
export function isValidExpansion(e: unknown): e is Expansion {
	return typeof (e as any)?.abbreviation === 'string' && (e as any).abbreviation.trim() !== ''
		&& typeof (e as any)?.expansion === 'string' && (e as any).expansion.trim() !== '';
}

/**
 * Merges two expansion lists, with overrides taking precedence over base
 * for same abbreviation (case-insensitive).
 */
export function mergeExpansions(base: Expansion[], overrides: Expansion[]): Expansion[] {
	const merged = new Map<string, Expansion>();
	for (const e of [...base, ...overrides]) {
		const key = e.abbreviation.toLowerCase();
		merged.set(key, { abbreviation: key, expansion: e.expansion });
	}
	return [...merged.values()];
}

/**
 * Merges two glossary arrays, deduplicating. Override terms listed first
 * so they are retained by Set deduplication when duplicates exist.
 */
export function mergeGlossary(workspaceTerms: string[], globalTerms: string[]): string[] {
	return [...new Set([...workspaceTerms, ...globalTerms])];
}

/**
 * Parses and validates a JSON glossary file content.
 * Returns an array of valid non-empty strings, or throws on parse errors.
 */
export function parseGlossaryFile(content: string): string[] {
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
}

/**
 * Parses and validates a JSON expansions file content.
 * Returns an array of valid Expansion objects, or empty array if not an array.
 */
export function parseExpansionsFile(content: string): { valid: Expansion[]; skipped: number } {
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) {
		return { valid: [], skipped: 0 };
	}
	const valid = parsed.filter(isValidExpansion);
	return { valid, skipped: parsed.length - valid.length };
}

export const WHISPER_MODELS: { name: string; file: string; size: string }[] = [
	{ name: 'tiny', file: 'ggml-tiny.bin', size: '~75 MB' },
	{ name: 'base', file: 'ggml-base.bin', size: '~148 MB' },
	{ name: 'small', file: 'ggml-small.bin', size: '~488 MB' },
	{ name: 'medium', file: 'ggml-medium.bin', size: '~1.5 GB' },
	{ name: 'large-v3-turbo', file: 'ggml-large-v3-turbo.bin', size: '~1.6 GB' },
];

export const WHISPER_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
