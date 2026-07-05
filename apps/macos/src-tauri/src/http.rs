//! Native Anthropic HTTPS forwarding (M3+).
//!
//! Claude cleanup runs through the Anthropic SDK, whose transport is the
//! WebView's `fetch`. In a production build the WebView loads from a `tauri://`
//! origin, and a cross-origin `fetch` to `api.anthropic.com` from that origin
//! stalls indefinitely — freezing the "Verarbeite mit Claude …" phase. Deepgram
//! already sidesteps this by going through native `reqwest` (see
//! `transcribe.rs`); this module gives Claude the same treatment. The SDK is
//! pointed at this command via a custom `fetch` in `adapters/anthropicTauriFetch.ts`.

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
    if !request.url.starts_with(ALLOWED_URL_PREFIX) {
        return Err(format!(
            "anthropic_fetch refused a non-Anthropic URL: {}",
            request.url
        ));
    }

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|e| format!("invalid HTTP method '{}': {e}", request.method))?;

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
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
