//! Native Deepgram REST transcription (M3).
//!
//! `@deepgram/sdk`'s `AbstractRestClient` constructor refuses to run in any
//! browser-like environment unless a `proxy` option is configured — it
//! throws unconditionally, before a custom `fetch` implementation even gets a
//! chance to run. Tauri's WebView is a real browser engine, so the SDK-based
//! `DeepgramProvider` in `@verba/core` cannot be used here. This module makes
//! the same REST call natively instead; `deepgramTauriProvider.ts` is the
//! concrete `TranscriptionBackend` (from `@verba/core`) that calls it.

use serde::Serialize;
use std::time::Duration;

/// Sentinel error string the frontend checks for to distinguish "bad API
/// key, clear it and re-prompt" from any other transcription failure.
///
/// Keep in sync with `UNAUTHORIZED_SENTINEL` in
/// `../../src/deepgramTauriProvider.ts` — there is no shared type across the
/// Rust/TypeScript IPC boundary to enforce this, so a drift here silently
/// breaks the invalid-key recovery path (the key is never cleared, and the
/// user sees a raw `Transcription failed: deepgram_unauthorized` instead).
const DEEPGRAM_UNAUTHORIZED: &str = "deepgram_unauthorized";

/// Requests hang instead of failing without this: `reqwest::Client::new()`
/// has no default timeout, and a stalled connection would otherwise leave
/// the frontend's "Transcribing…" phase stuck forever with no error.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Error bodies that aren't JSON (e.g. an HTML page from a proxy/WAF in
/// front of Deepgram) are truncated to this many characters before being
/// embedded in an error message, so a large error page doesn't end up
/// verbatim in a user-facing notification.
const MAX_RAW_BODY_IN_ERROR: usize = 300;

#[derive(Serialize, Debug, PartialEq)]
pub struct TranscriptionResult {
    text: String,
    #[serde(rename = "detectedLanguage", skip_serializing_if = "Option::is_none")]
    detected_language: Option<String>,
}

/// Transcribes the WAV file at `audio_path` via Deepgram's Nova-3 pre-recorded
/// REST API. `keyterms` are glossary terms already formatted and truncated by
/// the caller (e.g. `"term:2"`); passed through as repeated `keyterm` query
/// params.
#[tauri::command]
pub async fn deepgram_transcribe(
    api_key: String,
    audio_path: String,
    keyterms: Vec<String>,
) -> Result<TranscriptionResult, String> {
    let audio = std::fs::read(&audio_path)
        .map_err(|e| format!("Transcription failed: could not read recording: {e}"))?;

    let mut params: Vec<(&str, String)> = vec![
        ("model", "nova-3".to_string()),
        ("language", "multi".to_string()),
        ("smart_format", "true".to_string()),
        ("detect_language", "true".to_string()),
    ];
    for kt in &keyterms {
        params.push(("keyterm", kt.clone()));
    }

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("failed to build the Deepgram HTTP client");

    let response = client
        .post("https://api.deepgram.com/v1/listen")
        .query(&params)
        .header("Authorization", format!("Token {api_key}"))
        .header("Content-Type", "audio/wav")
        .body(audio)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Transcription failed: request timed out — check your network connection"
                    .to_string()
            } else {
                format!("Transcription failed: {e}")
            }
        })?;

    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(DEEPGRAM_UNAUTHORIZED.to_string());
    }

    let raw_body = response.text().await.map_err(|e| {
        format!(
            "Transcription failed ({}): could not read response body: {e}",
            status.as_u16()
        )
    })?;

    if !status.is_success() {
        return Err(build_error_message(status.as_u16(), &raw_body));
    }

    let body: serde_json::Value = serde_json::from_str(&raw_body).map_err(|e| {
        format!(
            "Transcription failed ({}): could not parse response: {e}",
            status.as_u16()
        )
    })?;

    Ok(parse_transcription(&body))
}

/// Builds a status-coded error message from a non-2xx response body. JSON
/// bodies contribute Deepgram's own `err_msg`/`reason` field; anything else
/// (HTML error pages, plain text, empty bodies) falls back to a truncated
/// raw snippet so the status code and *some* detail always reach the user,
/// rather than a generic "could not parse response".
fn build_error_message(status: u16, raw_body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(raw_body)
        .ok()
        .and_then(|v| {
            v.get("err_msg")
                .or_else(|| v.get("reason"))
                .and_then(|d| d.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| truncate_for_display(raw_body));

    format!("Transcription failed ({status}): {detail}")
}

fn truncate_for_display(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "(empty response body)".to_string();
    }
    if trimmed.chars().count() <= MAX_RAW_BODY_IN_ERROR {
        return trimmed.to_string();
    }
    let truncated: String = trimmed.chars().take(MAX_RAW_BODY_IN_ERROR).collect();
    format!("{truncated}…")
}

/// Extracts the transcript and detected language from a successful Deepgram
/// response body. Logs when the `channels` array is absent — that shape
/// mismatch (schema drift, a truncated/unexpected 200 body) would otherwise
/// be indistinguishable from a genuinely silent recording, since both
/// collapse to an empty transcript here.
fn parse_transcription(body: &serde_json::Value) -> TranscriptionResult {
    let channel = body
        .get("results")
        .and_then(|r| r.get("channels"))
        .and_then(|c| c.get(0));

    if channel.is_none() {
        eprintln!("[Verba] deepgram_transcribe: unexpected response shape (no channels): {body}");
    }

    let text = channel
        .and_then(|c| c.get("alternatives"))
        .and_then(|a| a.get(0))
        .and_then(|a| a.get("transcript"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    let detected_language = channel
        .and_then(|c| c.get("detected_language"))
        .and_then(|l| l.as_str())
        .map(|s| s.to_string());

    TranscriptionResult {
        text,
        detected_language,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unauthorized_sentinel_matches_the_frontend_constant() {
        // Guards the cross-language IPC contract with UNAUTHORIZED_SENTINEL
        // in deepgramTauriProvider.ts — this test only catches drift on the
        // Rust side, so keep both in sync by hand when changing either.
        assert_eq!(DEEPGRAM_UNAUTHORIZED, "deepgram_unauthorized");
    }

    #[test]
    fn parse_transcription_extracts_text_and_language() {
        let body = json!({
            "results": {
                "channels": [{
                    "alternatives": [{ "transcript": "hello world" }],
                    "detected_language": "en"
                }]
            }
        });

        let result = parse_transcription(&body);
        assert_eq!(
            result,
            TranscriptionResult {
                text: "hello world".to_string(),
                detected_language: Some("en".to_string()),
            }
        );
    }

    #[test]
    fn parse_transcription_defaults_language_to_none_when_absent() {
        let body = json!({
            "results": {
                "channels": [{ "alternatives": [{ "transcript": "hi" }] }]
            }
        });

        let result = parse_transcription(&body);
        assert_eq!(result.detected_language, None);
    }

    #[test]
    fn parse_transcription_returns_empty_text_when_channels_missing() {
        // Schema drift and genuine silence both land here; the eprintln! in
        // parse_transcription is what makes the two distinguishable in logs.
        let body = json!({ "results": {} });

        let result = parse_transcription(&body);
        assert_eq!(result.text, "");
        assert_eq!(result.detected_language, None);
    }

    #[test]
    fn parse_transcription_returns_empty_text_when_alternatives_missing() {
        let body = json!({
            "results": { "channels": [{}] }
        });

        let result = parse_transcription(&body);
        assert_eq!(result.text, "");
    }

    #[test]
    fn build_error_message_prefers_err_msg() {
        let body = json!({ "err_msg": "invalid audio format" }).to_string();
        assert_eq!(
            build_error_message(400, &body),
            "Transcription failed (400): invalid audio format"
        );
    }

    #[test]
    fn build_error_message_falls_back_to_reason() {
        let body = json!({ "reason": "quota exceeded" }).to_string();
        assert_eq!(
            build_error_message(429, &body),
            "Transcription failed (429): quota exceeded"
        );
    }

    #[test]
    fn build_error_message_falls_back_to_raw_body_for_non_json() {
        let body = "<html>Bad Gateway</html>";
        assert_eq!(
            build_error_message(502, body),
            "Transcription failed (502): <html>Bad Gateway</html>"
        );
    }

    #[test]
    fn build_error_message_truncates_long_non_json_bodies() {
        let body = "x".repeat(500);
        let message = build_error_message(500, &body);
        assert!(message.starts_with("Transcription failed (500): "));
        assert!(message.ends_with('…'));
        assert!(message.len() < body.len());
    }

    #[test]
    fn build_error_message_handles_empty_body() {
        assert_eq!(
            build_error_message(503, ""),
            "Transcription failed (503): (empty response body)"
        );
    }
}
