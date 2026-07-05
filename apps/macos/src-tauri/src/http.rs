//! Native Anthropic HTTPS forwarding.
//!
//! Claude cleanup runs through the Anthropic SDK, whose transport is the
//! WebView's `fetch`. Empirically, in a production build (where the WebView
//! loads from a `tauri://` origin) a `fetch` to `api.anthropic.com` never
//! completes and freezes the "Verarbeite mit Claude …" phase; the same call
//! works under `macos-dev` (origin `http://localhost:1420`). The exact cause
//! isn't confirmed — most likely the cross-origin preflight from a non-`http`
//! origin — but the fix is to leave the WebView transport entirely. Deepgram
//! transcription already uses a native `reqwest` path (`transcribe.rs`), though
//! for a different reason (the Deepgram SDK refuses to construct in a
//! browser-like environment at all); this module gives Claude an equivalent
//! native path. The Anthropic SDK is pointed here via a custom `fetch` in
//! `adapters/anthropicTauriFetch.ts`.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Requests hang instead of failing without this: `reqwest` has no default
/// timeout, and a stalled connection would otherwise leave the frontend's
/// "Verarbeite mit Claude …" phase stuck forever (same rationale as
/// `transcribe.rs`). The frontend's `withCleanupTimeout` is the outer bound;
/// this is the transport-level one.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// This command forwards caller-supplied headers verbatim — including the
/// Anthropic API key — so it must never reach any other host. Refuse anything
/// that isn't the Anthropic API (SSRF guard).
const ALLOWED_URL_PREFIX: &str = "https://api.anthropic.com/";

/// True only for URLs under the Anthropic API. The trailing slash in
/// `ALLOWED_URL_PREFIX` is load-bearing: it rejects look-alikes such as
/// `https://api.anthropic.com.evil.com/…` and `https://api.anthropic.com@evil.com/…`
/// (in both, the character after `api.anthropic.com` is not `/`).
fn is_allowed_anthropic_url(url: &str) -> bool {
    url.starts_with(ALLOWED_URL_PREFIX)
}

#[derive(Deserialize)]
pub struct HttpRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// Performs an Anthropic HTTPS request natively via `reqwest` and returns the
/// status, headers, and body for the JS side to rebuild into a `Response`.
#[tauri::command]
pub async fn anthropic_fetch(request: HttpRequest) -> Result<HttpResponse, String> {
    if !is_allowed_anthropic_url(&request.url) {
        return Err(format!(
            "anthropic_fetch refused a non-Anthropic URL: {}",
            request.url
        ));
    }

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|e| format!("invalid HTTP method '{}': {e}", request.method))?;

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        // Never follow redirects: `reqwest` does not strip custom headers on a
        // cross-host redirect, so a 3xx away from api.anthropic.com would carry
        // the `x-api-key` to another host — defeating the allowlist above. The
        // Anthropic API doesn't redirect, so this only closes an exfil vector.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("failed to build the Anthropic HTTP client: {e}"))?;

    let mut req = client.request(method, &request.url);
    for (name, value) in &request.headers {
        req = req.header(name, value);
    }
    if let Some(body) = request.body {
        req = req.body(body);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {e}"))?;

    let status = response.status().as_u16();

    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(name.as_str().to_string(), v.to_string());
        }
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read the Anthropic response body: {e}"))?;

    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::is_allowed_anthropic_url;

    #[test]
    fn allows_anthropic_api_urls() {
        assert!(is_allowed_anthropic_url(
            "https://api.anthropic.com/v1/messages"
        ));
    }

    #[test]
    fn rejects_other_hosts() {
        assert!(!is_allowed_anthropic_url("https://evil.com/v1/messages"));
        assert!(!is_allowed_anthropic_url("https://api.deepgram.com/v1/listen"));
    }

    #[test]
    fn rejects_prefix_lookalikes() {
        // The trailing slash in the prefix blocks suffix / userinfo bypasses.
        assert!(!is_allowed_anthropic_url(
            "https://api.anthropic.com.evil.com/v1/messages"
        ));
        assert!(!is_allowed_anthropic_url(
            "https://api.anthropic.com@evil.com/v1/messages"
        ));
    }

    #[test]
    fn rejects_non_https_scheme() {
        assert!(!is_allowed_anthropic_url("http://api.anthropic.com/v1/messages"));
    }
}
