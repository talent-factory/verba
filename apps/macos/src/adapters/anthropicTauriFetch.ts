import type { InvokeFn } from '../controller';

/** `fetch`-compatible signature (matches the Anthropic SDK's `Fetch` type). */
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Shape returned by the Rust `anthropic_fetch` command. */
interface RustHttpResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

/** Flattens any `HeadersInit` (Headers, array, or record) to a plain record. */
function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) {
		return out;
	}
	if (headers instanceof Headers) {
		headers.forEach((value, key) => { out[key] = value; });
	} else if (Array.isArray(headers)) {
		for (const [key, value] of headers) { out[key] = value; }
	} else {
		for (const [key, value] of Object.entries(headers)) { out[key] = value; }
	}
	return out;
}

/** Normalizes any `BodyInit` to a string (the SDK sends JSON string bodies). */
async function bodyToString(body: BodyInit | null | undefined): Promise<string | null> {
	if (body == null) {
		return null;
	}
	if (typeof body === 'string') {
		return body;
	}
	// Normalize Blob / ArrayBuffer / typed-array bodies via a throwaway Response.
	return new Response(body).text();
}

// Statuses whose Response must have a null body — constructing one with a body throws.
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * A `fetch`-compatible function that routes Anthropic HTTPS requests through the
 * Rust `anthropic_fetch` command (native `reqwest`) instead of the WKWebView's
 * `fetch`. Empirically, in the production build the webview runs on a `tauri://`
 * origin and a `fetch` to api.anthropic.com from there never completes, freezing
 * cleanup — while under `macos-dev` (origin `http://localhost:1420`) it works.
 * The exact cause is unconfirmed (most likely the cross-origin preflight from a
 * non-`http` origin); the fix is to leave the webview transport. The native path
 * has no origin and its own 30s timeout. Transcription uses a native `reqwest`
 * path too (`deepgram_transcribe`), for a different underlying reason.
 *
 * Cancellation is real, not best-effort (TF-521): an already-aborted signal is
 * honored *before* dispatch, and a mid-flight abort fires the `cancel_request`
 * command with the id minted here, which cancels the token the native
 * `anthropic_fetch` is `select!`ing on and stops the in-flight reqwest — so a
 * timeout no longer bills Anthropic for a result already discarded. The abort
 * listener is torn down once the request settles.
 */
export function createAnthropicTauriFetch(invoke: InvokeFn): FetchFn {
	return async (input, init) => {
		const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		if (signal?.aborted) {
			throw new DOMException('The operation was aborted.', 'AbortError');
		}

		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
		const headers = headersToRecord(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		const body = await bodyToString(init?.body);

		const requestId = crypto.randomUUID();
		// A dispatched Tauri `invoke` can't be cancelled, so on abort we instead
		// fire `cancel_request(requestId)`; the native command cancels the token
		// it's `select!`ing on and stops the reqwest. Fire-and-forget: the request
		// we're abandoning may reject as a result, which the caller already
		// tolerates (withCleanupTimeout has moved on).
		const onAbort = (): void => { void invoke('cancel_request', { requestId }).catch(() => {}); };
		signal?.addEventListener('abort', onAbort, { once: true });

		try {
			const res = await invoke<RustHttpResponse>('anthropic_fetch', {
				request: { url, method, headers, body, requestId },
			});

			return new Response(NULL_BODY_STATUS.has(res.status) ? null : res.body, {
				status: res.status,
				headers: res.headers,
			});
		} finally {
			// Drop the listener so a later abort of a reused signal can't fire a
			// stray cancel_request against an id whose request already settled.
			signal?.removeEventListener('abort', onAbort);
		}
	};
}
