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
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/**
 * A `fetch`-compatible function that routes Anthropic HTTPS requests through the
 * Rust `anthropic_fetch` command (native `reqwest`) instead of the WKWebView's
 * `fetch`. In the production build the webview runs on a `tauri://` origin whose
 * cross-origin `fetch` to api.anthropic.com stalls indefinitely (no origin the
 * browser will do CORS for); the native path has no origin / CORS and carries
 * its own request timeout, exactly like `deepgram_transcribe`. Deepgram already
 * goes through Rust for this reason — this gives Claude cleanup the same path.
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

		const res = await invoke<RustHttpResponse>('anthropic_fetch', {
			request: { url, method, headers, body },
		});

		return new Response(NULL_BODY_STATUS.has(res.status) ? null : res.body, {
			status: res.status,
			headers: res.headers,
		});
	};
}
