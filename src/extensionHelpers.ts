import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { findFfmpeg } from './recorder';
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
	} catch (err) {
		console.warn('[Verba] Could not parse URL for trust check:', urlString, err);
		return false;
	}
}

/** Silently removes a file if it exists. Logs errors for non-ENOENT failures. */
/**
 * Known Whisper hallucination patterns that appear when audio contains
 * mostly silence or very short speech fragments. These are well-documented
 * artifacts of the Whisper model and never represent genuine dictation.
 */
// CONSERVATIVE list — only patterns that NEVER appear in genuine dictation.
// Kept minimal to avoid discarding real speech that Whisper mangled.
// The primary defense against hallucinations is the VAD check (volume level),
// not this pattern filter.
const WHISPER_HALLUCINATION_PATTERNS: RegExp[] = [
	/Microsoft\s+Office\s+Word/i,
	/MSWordDoc/i,
	/Word\.Document/i,
	/^\.+$/,            // Only dots
	/^[\s.…♪,]+$/,     // Only punctuation, whitespace, music notes
	/^\s*\.{3,}\s*$/,   // Multiple dots/ellipsis only
];

/** Returns true if the transcript looks like a Whisper hallucination. */
export function isWhisperHallucination(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) { return true; }
	return WHISPER_HALLUCINATION_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Runs ffmpeg's volumedetect filter on an audio file and returns the mean
 * volume in dB. Returns null if detection fails. Typical values:
 * -20 dB (loud speech), -35 dB (quiet), -50 dB (near silence), -91 dB (digital silence).
 *
 * Used as Voice Activity Detection (VAD) before sending audio to Whisper,
 * preventing hallucinations on silence-only segments.
 */
export function detectMeanVolume(filePath: string): number | null {
	const ffmpegPath = findFfmpeg();
	if (!ffmpegPath) { return null; }

	try {
		// volumedetect outputs stats to stderr. execFileSync with stdio 'pipe'
		// captures both stdout and stderr via the thrown error on non-zero exit.
		// ffmpeg exits with code 0 when processing -f null output.
		const stderr = execFileSync(ffmpegPath, [
			'-i', filePath,
			'-af', 'volumedetect',
			'-f', 'null',
			'-',
		], { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
		// execFileSync returns stdout; volumedetect writes to stderr.
		// For -f null, ffmpeg might return the info in stdout or we need to catch stderr.
		const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
		if (match) {
			return parseFloat(match[1]);
		}
		return null;
	} catch (err: unknown) {
		// execFileSync throws on non-zero exit, but stderr is in err.stderr
		if (err && typeof err === 'object' && 'stderr' in err) {
			const stderr = (err as { stderr: string }).stderr;
			const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
			if (match) {
				return parseFloat(match[1]);
			}
		}
		return null;
	}
}

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
 * Returns valid terms and an optional warning if the format was unexpected.
 */
export function parseGlossaryFile(content: string): { terms: string[]; warning?: string } {
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) {
		return { terms: [], warning: 'Glossary file must be a JSON array of strings' };
	}
	return { terms: parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '') };
}

/**
 * Parses and validates a JSON expansions file content.
 * Returns valid expansions, skip count, and an optional warning if the format was unexpected.
 */
export function parseExpansionsFile(content: string): { valid: Expansion[]; skipped: number; warning?: string } {
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) {
		return { valid: [], skipped: 0, warning: 'Expansions file must be a JSON array of {abbreviation, expansion} objects' };
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
