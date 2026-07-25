/**
 * Platform-agnostic transcription contracts shared by all backends.
 *
 * A {@link TranscriptionBackend} turns a recorded utterance into text. Concrete
 * backends live either in core (portable, e.g. the Deepgram REST provider) or
 * in a host (desktop-only, e.g. the local whisper.cpp provider).
 */

/** Result of a transcription operation: the transcript plus an optional detected language. */
export interface TranscriptionResult {
	text: string;
	/** ISO 639-1 language code detected by the backend (e.g. "de", "en"). Undefined when unavailable. */
	detectedLanguage?: string;
}

/** A transcription strategy. Given an audio source, produces a transcript. */
export interface TranscriptionBackend {
	readonly name: string;
	/**
	 * Transcribes the audio identified by `source` (a file path on Node hosts,
	 * or an opaque handle elsewhere), optionally biased by `glossary` terms.
	 */
	transcribe(source: string, glossary?: string[]): Promise<TranscriptionResult>;
}

/**
 * Thrown by {@link validateTranscript} when a recording contains no usable
 * speech (empty, whitespace-only, or silence/dots only). A typed error so
 * callers can distinguish "no speech" from other transcription failures via
 * `instanceof` — the same pattern the macOS host uses for CleanupTimeoutError
 * and StopCaptureTimeoutError. Extends Error, so existing `catch (err)`
 * handlers that treat it as an Error stay compatible.
 */
export class NoSpeechError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NoSpeechError';
	}
}

/**
 * Validates a raw transcript, rejecting empty or silence-only results.
 * Shared by every backend so the "no speech detected" contract is identical.
 * @throws {NoSpeechError} when the transcript is empty, whitespace-only, or only dots/ellipsis.
 */
export function validateTranscript(rawText: string): string {
	if (!rawText || rawText.trim() === '') {
		throw new NoSpeechError('No speech detected in recording.');
	}

	// Whisper/Deepgram may return dots/ellipsis when it receives audio without speech
	if (/^[\s.…]+$/.test(rawText)) {
		throw new NoSpeechError(
			'No speech detected in recording (only silence). '
			+ 'Check that the correct microphone is selected — configure "verba.audioDevice" in Settings.'
		);
	}

	return rawText;
}
